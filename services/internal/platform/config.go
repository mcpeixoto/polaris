// Package platform holds process-level concerns: configuration, logging, health,
// metrics and graceful shutdown. Nothing in here knows what an issue is.
package platform

import (
	"fmt"
	"time"

	"github.com/kelseyhightower/envconfig"
)

// Config is the whole of the process's tunable surface. It fails fast on a missing
// required value rather than starting up and failing on the first request — a container
// that refuses to start is a much louder signal than one that 500s intermittently.
type Config struct {
	Env      string `envconfig:"POLARIS_ENV" default:"development"`
	LogLevel string `envconfig:"POLARIS_LOG_LEVEL" default:"info"`

	// Absolute base URL clients reach the product on. Used to build invite links,
	// OAuth redirect URIs and webhook callback URLs, so it must be externally correct
	// even in development.
	PublicURL string `envconfig:"POLARIS_PUBLIC_URL" default:"http://localhost:5173"`

	// Extra origins allowed to call this API cross-origin, comma separated.
	//
	// Empty by default, and that is the intended state for almost every install: the web
	// client is served by this same origin and needs no CORS at all, and the desktop app's
	// own scheme is allowed unconditionally. This exists for the self-hoster running a
	// separate front end or a staging desktop build, so that case does not require
	// patching the binary.
	//
	// Every entry is echoed back with Access-Control-Allow-Credentials, so an origin listed
	// here can act as the user with their own cookies. It is a list of origins you control.
	AllowedOrigins []string `envconfig:"POLARIS_ALLOWED_ORIGINS"`

	DatabaseURL string `envconfig:"DATABASE_URL" required:"true"`
	ValkeyURL   string `envconfig:"VALKEY_URL" default:"redis://localhost:56379/0"`

	// Signing key for access tokens. Refresh tokens are opaque and stored, so rotating
	// this invalidates access tokens only — sessions survive.
	JWTSecret       string        `envconfig:"POLARIS_JWT_SECRET" required:"true"`
	AccessTokenTTL  time.Duration `envconfig:"POLARIS_ACCESS_TOKEN_TTL" default:"15m"`
	RefreshTokenTTL time.Duration `envconfig:"POLARIS_REFRESH_TOKEN_TTL" default:"720h"`

	APIAddr     string `envconfig:"POLARIS_API_ADDR" default:":8088"`
	SyncAddr    string `envconfig:"POLARIS_SYNC_ADDR" default:":8089"`
	MetricsAddr string `envconfig:"POLARIS_METRICS_ADDR" default:"127.0.0.1:9090"`

	// Pool sizing. Kept low by default because pgbouncer sits in front in production and
	// oversized per-process pools are how a fleet exhausts max_connections.
	DBMaxConns        int32         `envconfig:"POLARIS_DB_MAX_CONNS" default:"10"`
	DBMinConns        int32         `envconfig:"POLARIS_DB_MIN_CONNS" default:"2"`
	DBMaxConnLifetime time.Duration `envconfig:"POLARIS_DB_MAX_CONN_LIFETIME" default:"1h"`

	ShutdownGrace time.Duration `envconfig:"POLARIS_SHUTDOWN_GRACE" default:"20s"`
}

// LoadConfig reads the environment. Call it once, at process start.
func LoadConfig() (Config, error) {
	var c Config
	if err := envconfig.Process("", &c); err != nil {
		return Config{}, fmt.Errorf("load config: %w", err)
	}
	if c.IsProduction() && len(c.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("POLARIS_JWT_SECRET must be at least 32 bytes in production")
	}
	return c, nil
}

func (c Config) IsProduction() bool  { return c.Env == "production" }
func (c Config) IsDevelopment() bool { return c.Env == "development" }
