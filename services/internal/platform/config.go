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

	// Who may create an account on this install. See RegistrationInvite below for the
	// vocabulary and RegistrationOpenSignup for what each value means.
	//
	// A string rather than a bool because "open signup: false" says nothing about how the
	// people who ARE allowed get in, and the answer — an invitation, or being the very first
	// account — is the whole of the policy. An operator reading `POLARIS_REGISTRATION_MODE=invite`
	// in their env file knows what their server does; one reading `POLARIS_OPEN_SIGNUP=false`
	// has to come and read this file.
	RegistrationMode string `envconfig:"POLARIS_REGISTRATION_MODE" default:"invite"`

	// DevAutoLogin mints a session for the local seed account without a password form.
	//
	// Empty follows POLARIS_ENV: on in development, off anywhere else. An explicit
	// 1/true turns it on; 0/false turns it off. Production refuses it even when the
	// flag is on — a mis-set env file must not open a public install.
	//
	// The HTTP handler still requires a loopback Host and a loopback RemoteAddr, so a
	// development process reached as a real hostname (a tunnel, a LAN IP, Docker
	// self-host behind Caddy) never issues a cookie. Invite-only registration is
	// unchanged.
	DevAutoLogin string `envconfig:"POLARIS_DEV_AUTOLOGIN"`

	// MaxWorkspacesPerAccount bounds how many workspaces one account may belong to.
	//
	// POST /auth/workspaces was reachable by any authenticated account with no restriction of
	// any kind — not a role check, not a rate limit, not a count. Each call seeds a team,
	// five workflow states, a version row, a notification cursor and a handful of change
	// rows, and every workspace that exists is one more the sync hub, the bootstrap endpoint
	// and the fan-out job carry forever. A single account could sit in a loop and grow the
	// database without ever doing anything a rate limiter on writes would notice.
	//
	// A count rather than a policy about WHO may create one, deliberately. Who should be
	// allowed is a product question with different answers for a self-hosted box, a community
	// instance and the cloud, and inventing one here would be a decision nobody asked for. A
	// ceiling is not a decision: twenty is far above anything a person does by hand and far
	// below anything that hurts, and an operator who disagrees sets the number.
	//
	// 0 means unlimited, for the operator who genuinely wants that and has said so.
	MaxWorkspacesPerAccount int `envconfig:"POLARIS_MAX_WORKSPACES_PER_ACCOUNT" default:"20"`

	// DefaultPlan is the entitlement plan a newly created workspace starts on.
	//
	// Self-hosted, because this repository is the self-hosted product and the cloud is the
	// deployment that knows it is special. The cloud sets "free" here and moves workspaces
	// with billing; a self-hoster should never meet a seat cap, which is what the README
	// promises and what the comment on PlanSelfHosted in internal/entitlement insists on.
	//
	// It was hardcoded to "free" in the workspace create path, so every install — including
	// every self-hosted one — was provisioning workspaces on a five-seat, two-team,
	// ninety-day plan.
	DefaultPlan string `envconfig:"POLARIS_DEFAULT_PLAN" default:"self_hosted"`

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

	// GitHub App OAuth. Empty is the supported state: the product runs, the settings
	// screen explains how to set the variables, and inbound webhooks plus the public
	// linkGitHubPullRequest mutation still work. Requiring an app before linking is how
	// self-host onboarding fails.
	GitHubClientID      string `envconfig:"POLARIS_GITHUB_CLIENT_ID"`
	GitHubClientSecret  string `envconfig:"POLARIS_GITHUB_CLIENT_SECRET"`
	GitHubWebhookSecret string `envconfig:"POLARIS_GITHUB_WEBHOOK_SECRET"`
	GitHubAppID         string `envconfig:"POLARIS_GITHUB_APP_ID"`
	GitHubAppPrivateKey string `envconfig:"POLARIS_GITHUB_APP_PRIVATE_KEY"`

	// Slack app credentials. Empty is supported: Settings → Slack still accepts a
	// Slack incoming-webhook URL for outbound issue notifications. Slash commands,
	// Events API unfurls, and inbound comments need the signing secret; unfurls
	// also need the bot token.
	SlackSigningSecret string `envconfig:"POLARIS_SLACK_SIGNING_SECRET"`
	SlackBotToken      string `envconfig:"POLARIS_SLACK_BOT_TOKEN"`

	// Shared secret for POST /webhooks/email. Empty is the development stub: unsigned
	// JSON is accepted so a local `curl` can file an issue without a mail server.
	// Production must set this — an empty secret outside development refuses every post.
	EmailWebhookSecret string `envconfig:"POLARIS_EMAIL_WEBHOOK_SECRET"`
}

// Registration modes.
//
// Two, and the default is the closed one. README states the product's policy — "invite-only
// beta first, no open signup until per-workspace quotas and abuse controls are proven" — and
// a default that contradicted it would mean every self-hoster who never read this file is
// running the configuration the project says is not ready.
const (
	// RegistrationInvite admits exactly two people: somebody holding a valid, pending,
	// unexpired invitation, and the very first account on an install that has none. Nobody
	// else, whatever they send.
	RegistrationInvite = "invite"

	// RegistrationOpen admits anybody who can reach the endpoint, rate-limited and nothing
	// more. This is the escape hatch for an operator who genuinely wants a public server —
	// a community instance, a demo — and who has read what that means. Invitations keep
	// working; this only removes the requirement to hold one.
	RegistrationOpen = "open"
)

// MailEnabled reports whether a relay is configured. A process with no mail must start
// normally and say so once, rather than failing a job every hour.
func (c Config) MailEnabled() bool { return strings.TrimSpace(c.SMTPHost) != "" }

// GitHubOAuthConfigured reports whether a GitHub App can complete an OAuth handshake.
func (c Config) GitHubOAuthConfigured() bool {
	return strings.TrimSpace(c.GitHubClientID) != "" && strings.TrimSpace(c.GitHubClientSecret) != ""
}

// OpenSignupAllowed reports whether anybody may create an account.
//
// Phrased as the permissive question so that the zero value of Config — and of anything
// derived from it that forgot to copy this across — answers "no". A misconfiguration that
// fails towards a closed server is a support ticket; one that fails towards an open server
// is the abuse report this whole mechanism exists to prevent.
func (c Config) OpenSignupAllowed() bool { return c.RegistrationMode == RegistrationOpen }

// LoadConfig reads the environment. Call it once, at process start.
func LoadConfig() (Config, error) {
	var c Config
	if err := envconfig.Process("", &c); err != nil {
		return Config{}, fmt.Errorf("load config: %w", err)
	}
	if c.IsProduction() && len(c.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("POLARIS_JWT_SECRET must be at least 32 bytes in production")
	}

	// Normalised, then checked, then refused. Accepting "Open" as open is not laxness — it
	// is a spelling, and an operator who capitalised it meant it. A value that is neither,
	// though, must stop the process: silently falling back to the safe default would leave
	// somebody who typed POLARIS_REGISTRATION_MODE=public certain they had opened their
	// server, and the only evidence to the contrary is a refusal their users see and they
	// do not.
	c.RegistrationMode = strings.ToLower(strings.TrimSpace(c.RegistrationMode))
	switch c.RegistrationMode {
	case RegistrationInvite, RegistrationOpen:
	default:
		return Config{}, fmt.Errorf(
			"POLARIS_REGISTRATION_MODE must be %q or %q, not %q",
			RegistrationInvite, RegistrationOpen, c.RegistrationMode)
	}
	// Normalised here and checked in cmd/api, which is the only layer allowed to know what
	// a plan is: internal/entitlement imports this package, so validating it here would be
	// an import cycle. The composition root knows both and is where the process decides
	// whether it is willing to start.
	c.DefaultPlan = strings.ToLower(strings.TrimSpace(c.DefaultPlan))

	return c, nil
}

func (c Config) IsProduction() bool  { return c.Env == "production" }
func (c Config) IsDevelopment() bool { return c.Env == "development" }

// DevAutoLoginAllowed is whether POST /auth/dev-session may be registered at all.
//
// Asked as the permissive question so a zero Config — and a wiring mistake that
// forgot to copy the field — answers no. The loopback checks in the handler are
// a second gate, not a substitute for this one.
func (c Config) DevAutoLoginAllowed() bool {
	if c.IsProduction() {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(c.DevAutoLogin)) {
	case "0", "false", "off", "no":
		return false
	case "1", "true", "on", "yes":
		return true
	default:
		return c.IsDevelopment()
	}
}
