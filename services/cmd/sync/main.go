// Command sync serves the WebSocket delta hub.
//
// It is a separate process from api because the two scale on different axes: the hub is
// connection- and memory-bound with almost no CPU, while the API is CPU- and
// database-bound with short-lived connections. Deploying them together would mean every
// API deploy dropped every socket in the fleet.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/syncsrv"
)

var revision = "dev"

func main() {
	if err := run(); err != nil {
		platform.Log(context.Background()).Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := platform.LoadConfig()
	if err != nil {
		return err
	}
	log := platform.NewLogger(cfg).With("service", "sync", "revision", revision)
	ctx, cancel := context.WithCancel(platform.WithLogger(context.Background(), log))
	defer cancel()

	// The hub holds a LISTEN subscription, which is session state. Behind pgbouncer in
	// transaction mode a pooled connection is handed to somebody else between statements
	// and the subscription silently evaporates — so this process connects straight to
	// Postgres when POLARIS_LISTEN_DATABASE_URL says to.
	dbURL := cfg.DatabaseURL
	if direct := os.Getenv("POLARIS_LISTEN_DATABASE_URL"); direct != "" {
		dbURL = direct
	}

	db, err := store.Open(ctx, store.PoolConfig{
		URL:      dbURL,
		MaxConns: cfg.DBMaxConns,
		MinConns: cfg.DBMinConns,
		// Deliberately no MaxConnLifetime: recycling the connection that holds LISTEN
		// would drop the subscription on a timer, and the symptom — updates stop arriving
		// for everybody, roughly hourly — is miserable to diagnose.
	})
	if err != nil {
		return err
	}
	defer db.Close()

	svc := domain.NewService(db)
	tokens := httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL)

	hub := syncsrv.NewHub(svc, log)
	go hub.Run(ctx)

	server := syncsrv.NewServer(hub, svc, tokens, log, allowedOrigins(cfg))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("GET /sync", server)

	srv := &http.Server{
		Addr:              cfg.SyncAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// No IdleTimeout: an idle WebSocket is the normal state of this service. The
		// heartbeat in the protocol is what detects a dead peer.
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.SyncAddr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errCh:
		return err
	case sig := <-stop:
		log.Info("shutting down", "signal", sig.String(), "sessions", hub.SessionCount())
	}

	// Closing sockets deliberately, rather than letting the process die, means clients
	// see a clean close and reconnect with backoff instead of all retrying at once the
	// instant the TCP connections reset.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer shutdownCancel()
	return srv.Shutdown(shutdownCtx)
}

// allowedOrigins is checked on the WebSocket handshake. Browsers do not apply CORS to
// upgrades, so without this any page on the internet could open a socket carrying the
// visitor's credentials.
func allowedOrigins(cfg platform.Config) []string {
	origins := []string{stripScheme(cfg.PublicURL)}
	if cfg.IsDevelopment() {
		origins = append(origins, "localhost:*", "127.0.0.1:*")
	}
	return origins
}

func stripScheme(u string) string {
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
	}
	return strings.TrimSuffix(u, "/")
}
