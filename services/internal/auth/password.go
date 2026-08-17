// Package auth holds the credential primitives: password hashing, opaque session tokens
// and signed access tokens. It deliberately knows nothing about the database or the HTTP
// layer, so that the rules encoded here — constant-time comparison, a pinned signing
// algorithm, bounded input — cannot be quietly bypassed by a caller that happens to have
// a *pgx.Pool to hand. Wiring lives one layer up.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Argon2id cost parameters, following the RFC 9106 second recommended option scaled to
// what a login handler can afford to run synchronously.
//
// These are expected to rise as hardware does, and raising them is precisely why
// NeedsRehash exists: the parameters are written into every stored hash, so an old hash
// keeps verifying under its own cost while a successful login can transparently replace it
// with one computed under the new cost. Nobody has to be forced to reset a password, and
// no migration has to walk the account table.
const (
	argonMemory      uint32 = 64 * 1024 // KiB, i.e. 64 MiB
	argonTime        uint32 = 3
	argonParallelism uint8  = 2
	argonSaltLength  int    = 16
	argonKeyLength   uint32 = 32

	// Bounds for a salt read back out of a stored hash. Wider than what this code
	// writes, so that hashes imported from another argon2 implementation still verify,
	// but narrow enough that a corrupted field is rejected rather than fed to the KDF.
	minSaltLength int = 8
	maxSaltLength int = 64
)

// MaxPasswordLength bounds what is fed into the KDF. Argon2id costs 64 MiB per call
// regardless of input size, but the hashing itself is linear in the password length, so an
// unbounded field on an unauthenticated endpoint is a free amplification factor for anyone
// who wants to exhaust the box. 1024 bytes is far past any human passphrase and well past
// what a password manager generates.
const MaxPasswordLength = 1024

// phcPrefix is the algorithm identifier of the only variant this package will verify.
// Accepting argon2i or argon2d here would mean silently verifying credentials under a
// weaker function than the one we promised to store them with.
const phcPrefix = "argon2id"

// HashPassword derives an Argon2id hash of plain and returns it in the PHC string format
//
//	$argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>
//
// with raw (unpadded) standard base64, which is what the reference implementation emits.
// Staying byte-compatible with it means the stored value is portable: a future service in
// another language, or an emergency script, can verify these hashes with any off-the-shelf
// argon2 library and no knowledge of this package.
func HashPassword(plain string) (string, error) {
	if plain == "" {
		return "", platform.Validation("password", "password must not be empty")
	}
	if len(plain) > MaxPasswordLength {
		return "", platform.Validation("password", "password must be at most "+strconv.Itoa(MaxPasswordLength)+" bytes")
	}

	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", platform.Internal(err)
	}

	key := argon2.IDKey([]byte(plain), salt, argonTime, argonMemory, argonParallelism, argonKeyLength)
	return encodePHC(argonMemory, argonTime, argonParallelism, salt, key), nil
}

// VerifyPassword reports whether plain is the password behind encoded.
//
// A malformed encoded string is an error and never a match: the two outcomes are kept
// distinct so a corrupted or truncated column cannot be mistaken by a caller for a wrong
// password, and cannot be mistaken for a right one either.
func VerifyPassword(encoded, plain string) (bool, error) {
	p, err := parsePHC(encoded)
	if err != nil {
		return false, err
	}
	if len(plain) > MaxPasswordLength {
		return false, platform.Validation("password", "password must be at most "+strconv.Itoa(MaxPasswordLength)+" bytes")
	}
	// HashPassword refuses the empty password, so no stored hash can correspond to one.
	// Short-circuiting avoids spending 64 MiB on an empty login form, and leaks nothing an
	// attacker submitting an empty password does not already know.
	if plain == "" {
		return false, nil
	}

	candidate := argon2.IDKey([]byte(plain), p.salt, p.time, p.memory, p.parallelism, uint32(len(p.hash)))

	// subtle.ConstantTimeCompare, not bytes.Equal. bytes.Equal returns as soon as two bytes
	// differ, so the time it takes reveals how long a prefix of the correct hash the caller
	// guessed — enough to reconstruct the hash byte by byte given enough attempts.
	return subtle.ConstantTimeCompare(candidate, p.hash) == 1, nil
}

// NeedsRehash reports whether encoded was produced under cost parameters that are no longer
// current, so that a caller which has just verified a password successfully — and therefore
// holds the plaintext exactly once — can replace the stored hash on the spot.
//
// An unparseable hash also reports true. It is only ever consulted after a successful
// verification, which a malformed hash cannot produce, so the answer is unreachable rather
// than wrong; reporting true keeps the function total without a second error return.
func NeedsRehash(encoded string) bool {
	p, err := parsePHC(encoded)
	if err != nil {
		return true
	}
	return p.memory != argonMemory ||
		p.time != argonTime ||
		p.parallelism != argonParallelism ||
		len(p.salt) != argonSaltLength ||
		uint32(len(p.hash)) != argonKeyLength
}

// phcHash is a decoded PHC string. The cost parameters travel with the hash rather than
// being read from the constants above, because a hash written under old parameters must be
// verified under those same old parameters or it will never match.
type phcHash struct {
	memory      uint32
	time        uint32
	parallelism uint8
	salt        []byte
	hash        []byte
}

func encodePHC(memory, time uint32, parallelism uint8, salt, hash []byte) string {
	var b strings.Builder
	b.WriteString("$")
	b.WriteString(phcPrefix)
	b.WriteString("$v=")
	b.WriteString(strconv.Itoa(argon2.Version))
	b.WriteString("$m=")
	b.WriteString(strconv.FormatUint(uint64(memory), 10))
	b.WriteString(",t=")
	b.WriteString(strconv.FormatUint(uint64(time), 10))
	b.WriteString(",p=")
	b.WriteString(strconv.FormatUint(uint64(parallelism), 10))
	b.WriteString("$")
	b.WriteString(base64.RawStdEncoding.EncodeToString(salt))
	b.WriteString("$")
	b.WriteString(base64.RawStdEncoding.EncodeToString(hash))
	return b.String()
}

// parsePHC decodes a PHC string with no tolerance for anything it did not expect.
//
// Every field is length-checked and prefix-checked before it is used, and the cost
// parameters are range-checked, because argon2.IDKey panics on a zero time or a zero
// parallelism and would happily try to allocate whatever memory figure it is handed. A
// hash column is normally ours, but "normally ours" is not a security property: a
// malformed value must come back as an error, never as a panic and never as a match.
func parsePHC(encoded string) (phcHash, error) {
	malformed := func() (phcHash, error) {
		return phcHash{}, platform.Validation("password", "malformed password hash")
	}

	// A well-formed string starts with '$', so the first segment is empty by construction.
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" {
		return malformed()
	}
	if parts[1] != phcPrefix {
		return phcHash{}, platform.Validation("password", "unsupported password hash algorithm")
	}

	version, err := parseUintField(parts[2], "v=", 32)
	if err != nil || version != uint64(argon2.Version) {
		return phcHash{}, platform.Validation("password", "unsupported password hash version")
	}

	costs := strings.Split(parts[3], ",")
	if len(costs) != 3 {
		return malformed()
	}
	memory, err := parseUintField(costs[0], "m=", 32)
	if err != nil {
		return malformed()
	}
	timeCost, err := parseUintField(costs[1], "t=", 32)
	if err != nil {
		return malformed()
	}
	parallelism, err := parseUintField(costs[2], "p=", 8)
	if err != nil {
		return malformed()
	}
	// argon2.IDKey panics rather than errors on these, and 1 GiB is already an order of
	// magnitude above anything this service would ever have written.
	if timeCost == 0 || parallelism == 0 || memory == 0 || memory > 1024*1024 {
		return malformed()
	}

	// Strict decoding rejects padded or non-canonical base64, so there is exactly one
	// encoding of any given hash and a tampered value cannot round-trip.
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) < minSaltLength || len(salt) > maxSaltLength {
		return malformed()
	}
	hash, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil {
		return malformed()
	}
	// The digest length is fixed, so a decodable value of the wrong length was never
	// written by this code — it is a truncated or corrupted column, not a wrong password.
	// Reporting it as a mismatch would hide that behind thousands of ordinary failed
	// logins; reporting it as an error puts it where corruption belongs, in the logs.
	if uint32(len(hash)) != argonKeyLength {
		return malformed()
	}

	return phcHash{
		memory:      uint32(memory),
		time:        uint32(timeCost),
		parallelism: uint8(parallelism),
		salt:        salt,
		hash:        hash,
	}, nil
}

// parseUintField insists on the exact prefix and on the whole remainder being digits,
// because strconv is the only step here that will not quietly accept trailing rubbish.
func parseUintField(field, prefix string, bitSize int) (uint64, error) {
	rest, ok := strings.CutPrefix(field, prefix)
	if !ok {
		return 0, platform.Validation("password", "malformed password hash")
	}
	v, err := strconv.ParseUint(rest, 10, bitSize)
	if err != nil {
		return 0, platform.Validation("password", "malformed password hash")
	}
	return v, nil
}
