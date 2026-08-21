package auth

import "context"

type refreshHashKey struct{}

// WithRefreshTokenHash remembers the SHA-256 of the polaris_refresh cookie for this
// request, so the sessions list can mark which row is this device without the GraphQL
// layer reading cookies.
//
// The hash, never the plaintext. A context value is visible to anything that holds the
// request, and the plaintext is a live credential.
func WithRefreshTokenHash(ctx context.Context, hash []byte) context.Context {
	if len(hash) == 0 {
		return ctx
	}
	return context.WithValue(ctx, refreshHashKey{}, hash)
}

// RefreshTokenHashFrom returns the digest the middleware stored, or nil when this request
// is not a browser session — an API key, an OAuth app, a cookie that was never set.
func RefreshTokenHashFrom(ctx context.Context) []byte {
	hash, _ := ctx.Value(refreshHashKey{}).([]byte)
	return hash
}
