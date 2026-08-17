// Package platform holds process-level concerns: configuration, logging, health,
// metrics and graceful shutdown. Nothing in here knows what an issue is.
package platform

import (
	"fmt"
	"strings"
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

	// Outbound mail, and it is optional.
	//
	// SMTPHost empty is not a misconfiguration, it is the default state of a self-hosted
	// install and a supported one: the product runs, the inbox works, and the digest job says
	// so once at startup and then does nothing. Requiring a relay before anything works is
	// named in docs/05-infrastructure/10-self-host-and-cloud.md as the most common way
	// self-host onboarding fails, and nothing in M1 is worth reintroducing it for.
	//
	// SMTPUsername and SMTPPassword are optional too — a relay listening on 127.0.0.1 that
	// accepts anything from the machine it runs on is the ordinary self-hosted setup. When
	// they are set, the client refuses to send them over a connection the relay has not
	// offered to encrypt.
	SMTPHost     string `envconfig:"POLARIS_SMTP_HOST"`
	SMTPPort     int    `envconfig:"POLARIS_SMTP_PORT" default:"587"`
	SMTPUsername string `envconfig:"POLARIS_SMTP_USERNAME"`
	SMTPPassword string `envconfig:"POLARIS_SMTP_PASSWORD"`
	// SMTPTimeout bounds one delivery, dialling to QUIT.
	SMTPTimeout time.Duration `envconfig:"POLARIS_SMTP_TIMEOUT" default:"30s"`

	// MailFrom is the envelope sender and the From header. Its domain is also the EHLO name
	// and the Message-ID's domain, and it is what SPF and DKIM are checked against, so it has
	// to be a domain this install is allowed to send as — a mismatch here is the difference
	// between the inbox and the spam folder.
	MailFrom     string `envconfig:"POLARIS_MAIL_FROM" default:"polaris@localhost"`
	MailFromName string `envconfig:"POLARIS_MAIL_FROM_NAME" default:"Polaris"`

	// Per-caller rate limits, and the defaults are chosen so that nobody using the product
	// ever meets one.
	//
	// The test a default has to pass is the self-hosted install with three people on it:
	// they share an office IP, they reload pages, their clients refresh tokens, and not one
	// of them should ever see a 429. So each number below is set at roughly an order of
	// magnitude above the busiest plausible human, which still leaves it two or three orders
	// of magnitude below what a loop with no sleep in it produces. A limit that catches a
	// real user is a limit that gets switched off, and a switched-off limit protects nothing.
	//
	// Every one of these can be set to 0 to switch that class off individually, and
	// RateLimitEnabled=false switches the whole thing off — which is the honest escape hatch
	// for an operator who has put their own limiter in front of this process.
	RateLimitEnabled bool `envconfig:"POLARIS_RATE_LIMIT_ENABLED" default:"true"`

	// The GraphQL endpoint, per caller, in requests and in complexity points. Both budgets
	// are spent by the same traffic: the request count catches a client looping on a trivial
	// query, and the complexity budget catches the one looping on an expensive one.
	RateLimitGraphQLRequests   int           `envconfig:"POLARIS_RATE_LIMIT_GRAPHQL_REQUESTS" default:"5000"`
	RateLimitGraphQLComplexity int           `envconfig:"POLARIS_RATE_LIMIT_GRAPHQL_COMPLEXITY" default:"2000000"`
	RateLimitGraphQLPeriod     time.Duration `envconfig:"POLARIS_RATE_LIMIT_GRAPHQL_PERIOD" default:"1h"`

	// Sign-in attempts against ONE account, whoever is making them. This is the tightest
	// budget in the process and the only one aimed at an attacker rather than at a runaway
	// client, because a password is the one secret in this system that can be guessed.
	RateLimitLoginAttempts int           `envconfig:"POLARIS_RATE_LIMIT_LOGIN_ATTEMPTS" default:"10"`
	RateLimitLoginPeriod   time.Duration `envconfig:"POLARIS_RATE_LIMIT_LOGIN_PERIOD" default:"10m"`

	// Unauthenticated requests, per source address. A courtesy limit — see the note in
	// internal/httpapi/ratelimit.go on why the per-account budget above is the one that
	// actually stops a brute force.
	RateLimitAnonRequests int           `envconfig:"POLARIS_RATE_LIMIT_ANON_REQUESTS" default:"120"`
	RateLimitAnonPeriod   time.Duration `envconfig:"POLARIS_RATE_LIMIT_ANON_PERIOD" default:"1m"`

	// Workspace snapshots, per user. docs/05-infrastructure/03-sync-engine.md sets this at
	// 3 per 10 minutes; the default here is looser because a developer with the dev server
	// reloading on save legitimately bootstraps more often than that, and being told to
	// come back in four minutes while editing is how a limit earns a reputation.
	RateLimitBootstraps      int           `envconfig:"POLARIS_RATE_LIMIT_BOOTSTRAPS" default:"10"`
	RateLimitBootstrapPeriod time.Duration `envconfig:"POLARIS_RATE_LIMIT_BOOTSTRAP_PERIOD" default:"10m"`

	// How many callers each limiter remembers before it starts reclaiming. Bounds the
	// limiter's memory: the keys are caller-supplied (an IP, an email address), so the map
	// is unbounded by construction and something has to cap it.
	RateLimitMaxCallers int `envconfig:"POLARIS_RATE_LIMIT_MAX_CALLERS" default:"100000"`
}

// MailEnabled reports whether a relay is configured. A process with no mail must start
// normally and say so once, rather than failing a job every hour.
func (c Config) MailEnabled() bool { return strings.TrimSpace(c.SMTPHost) != "" }

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
