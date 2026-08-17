package platform

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

type contextKey int

const (
	ctxKeyLogger contextKey = iota
	ctxKeyRequestID
)

// NewLogger returns a JSON logger. Container logs are already capped and shipped by the
// fleet's logging config, so the process just writes structured lines to stdout.
func NewLogger(cfg Config) *slog.Logger {
	var level slog.Level
	switch strings.ToLower(cfg.LogLevel) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			// Never let a token, password or key reach the log, whatever a caller passes.
			switch strings.ToLower(a.Key) {
			case "password", "token", "secret", "authorization", "cookie", "password_hash":
				return slog.String(a.Key, "[redacted]")
			}
			return a
		},
	}

	var h slog.Handler = slog.NewJSONHandler(os.Stdout, opts)
	if cfg.IsDevelopment() {
		h = slog.NewTextHandler(os.Stdout, opts)
	}
	return slog.New(h).With(slog.String("env", cfg.Env))
}

// WithLogger stores a request-scoped logger on the context.
func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxKeyLogger, l)
}

// Log returns the context's logger, or the default if none was attached. It never
// returns nil, so callers never need to check.
func Log(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxKeyLogger).(*slog.Logger); ok && l != nil {
		return l
	}
	return slog.Default()
}

// WithRequestID stores a correlation id used to tie an HTTP request, its database
// queries, its emitted change_log rows and its job enqueues together in the logs.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKeyRequestID, id)
}

func RequestID(ctx context.Context) string {
	if s, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		return s
	}
	return ""
}
