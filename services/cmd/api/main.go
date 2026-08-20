// Command api serves the GraphQL API, the auth endpoints and the bootstrap snapshot.
//
// It is one of three entrypoints built from a single image (see services/Dockerfile), so
// api, sync and worker always share a revision and can never disagree about the schema.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/lru"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/vektah/gqlparser/v2/ast"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/graph"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	ghclient "github.com/peixotolabs/polaris/services/internal/integrations/github"
	glclient "github.com/peixotolabs/polaris/services/internal/integrations/gitlab"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// revision is stamped at build time with the git SHA and reported in logs and on the
// container's OCI label, so a running process can always be traced to a commit.
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

	// Checked here rather than in platform, which cannot import entitlement without a
	// cycle, and rather than at the first signup, which on a fresh install is the worst
	// moment to discover a typo. A process that refuses to start is a much louder signal
	// than one that provisions everybody onto a plan the operator did not choose.
	if !entitlement.Plan(cfg.DefaultPlan).Valid() {
		return fmt.Errorf("POLARIS_DEFAULT_PLAN must be one of %v, not %q",
			entitlement.AllPlans, cfg.DefaultPlan)
	}

	log := platform.NewLogger(cfg).With("service", "api", "revision", revision)
	ctx := platform.WithLogger(context.Background(), log)

	db, err := store.Open(ctx, store.PoolConfig{
		URL:             cfg.DatabaseURL,
		MaxConns:        cfg.DBMaxConns,
		MinConns:        cfg.DBMinConns,
		MaxConnLifetime: cfg.DBMaxConnLifetime,
	})
	if err != nil {
		return err
	}
	defer db.Close()

	svc := domain.NewService(db)
	svc.PublicURL = cfg.PublicURL
	svc.SetGitHubCommentPoster(ghclient.CommentClient{})
	svc.SetGitLabCommentPoster(glclient.CommentClient{})
	tokens := httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL)

	// Built once and shared: the router charges requests to these buckets and the GraphQL
	// handler charges complexity to the same ones. Two instances would each see half the
	// traffic and enforce twice the limit.
	limits := httpapi.NewLimits(cfg)
	if limits == nil {
		log.Warn("per-caller rate limiting is disabled by configuration")
	}

	router := httpapi.NewRouter(httpapi.Deps{
		Service: svc,
		Tokens:  tokens,
		Config:  cfg,
		GraphQL: newGraphQLHandler(svc, cfg),
		Limits:  limits,
	})

	srv := &http.Server{
		Addr:    cfg.APIAddr,
		Handler: router,
		// No WriteTimeout: the bootstrap endpoint streams a snapshot that can legitimately
		// take a minute on a large workspace, and a write deadline would truncate it
		// mid-stream with no way to signal the failure. ReadHeaderTimeout still protects
		// against a slowloris holding connections open with a dribble of headers.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.APIAddr, "env", cfg.Env)
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
		log.Info("shutting down", "signal", sig.String())
	}

	// Drain in-flight requests before exiting. Without this a deploy returns a burst of
	// connection resets to clients that were mid-mutation, and their outboxes retry —
	// which is safe because of the idempotency keys, but noisy and slow for the user.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

func newGraphQLHandler(svc *domain.Service, cfg platform.Config) http.Handler {
	es := generated.NewExecutableSchema(generated.Config{
		Resolvers: &graph.Resolver{
			Svc:                    svc,
			PublicURL:              cfg.PublicURL,
			GitHubOAuthConfigured:  cfg.GitHubOAuthConfigured(),
			SlackSigningConfigured: strings.TrimSpace(cfg.SlackSigningSecret) != "",
			SlackBotConfigured:     strings.TrimSpace(cfg.SlackBotToken) != "",
		},
		Directives: graph.Directives(),
	})

	h := handler.New(es)
	h.AddTransport(transport.POST{})

	// The backstop the resolvers do not rely on.
	//
	// Every resolver already calls graph.PresentError itself, and the comment on that
	// function explains why both exist: an unclassified error's text routinely carries a
	// database string — a constraint name, a fragment of SQL, another workspace's id — and
	// one forgotten call would turn that leak on with no failing test. It was never
	// installed here, so until now the resolvers were the only thing standing between a raw
	// error and a client, which is exactly the arrangement the duplication exists to avoid.
	//
	// Presenting twice is harmless: PresentError is idempotent on its own output.
	h.SetErrorPresenter(graph.PresentError)

	// Likewise a panic. gqlgen's default is not a leak — it answers "internal system
	// error" — but it prints the value and stack to stderr with no request id, no field
	// path and no structure, and it returns an error carrying no `extensions.code`. So the
	// one failure that most needs to be traceable is the one that lands outside the logs
	// everything else is in, and clients that branch on the code see nothing to branch on.
	h.SetRecoverFunc(graph.RecoverPanic)

	h.SetQueryCache(lru.New[*ast.QueryDocument](1000))
	h.Use(extension.AutomaticPersistedQuery{Cache: lru.New[string](100)})
	// Scores every operation by the model docs/03-platform/01-graphql-api.md publishes,
	// refuses the ones over the ceiling, and bills the rest. gqlgen's own
	// extension.FixedComplexityLimit used to sit here and is deliberately gone: it scored
	// every field at 1, so the ceiling it enforced was one no real query could reach.
	h.Use(complexityBudget{})
	h.AroundFields(graph.EnforceOauthScopes)

	if !cfg.IsDevelopment() {
		return h
	}

	// Development only. Introspection is genuinely useful to integration authors, but it
	// also hands an attacker a complete map of the surface — and the schema is published
	// in the repository, which serves that audience better anyway.
	h.AddTransport(transport.GET{})
	h.Use(extension.Introspection{})

	mux := http.NewServeMux()
	mux.Handle("/", h)
	mux.Handle("/playground", playground.Handler("Polaris", "/graphql"))
	return mux
}
