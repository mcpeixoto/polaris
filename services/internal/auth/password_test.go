package auth

import (
	"encoding/base64"
	"strings"
	"testing"

	"golang.org/x/crypto/argon2"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// These tests exist before any caller does. Every one of them describes a way a password
// check has historically been got wrong — a timing oracle, a parser that panics, a KDF fed
// unbounded input — rather than a way this particular implementation happens to be written.

func TestHashPassword_VerifiesItsOwnOutput(t *testing.T) {
	const pw = "correct horse battery staple"

	encoded, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("hashing a normal password must succeed: %v", err)
	}

	ok, err := VerifyPassword(encoded, pw)
	if err != nil {
		t.Fatalf("verifying a hash this package produced must not error: %v", err)
	}
	if !ok {
		t.Error("the password that produced a hash must verify against it, or nobody can log in")
	}

	ok, err = VerifyPassword(encoded, "correct horse battery stapl")
	if err != nil {
		t.Fatalf("a wrong password is not an error, it is a false: %v", err)
	}
	if ok {
		t.Error("a password differing by one byte must NOT verify")
	}
}

func TestHashPassword_SaltIsRandomPerHash(t *testing.T) {
	const pw = "the same password twice"

	first, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("first hash: %v", err)
	}
	second, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("second hash: %v", err)
	}

	if first == second {
		t.Fatal("two hashes of one password must differ, or the salt is not random and the whole account table is one rainbow-table lookup")
	}

	for name, encoded := range map[string]string{"first": first, "second": second} {
		ok, err := VerifyPassword(encoded, pw)
		if err != nil {
			t.Fatalf("%s hash must verify without error: %v", name, err)
		}
		if !ok {
			t.Errorf("%s hash must verify: a random salt must not change the answer, only the bytes", name)
		}
	}
}

func TestHashPassword_RejectsUnusableInput(t *testing.T) {
	tests := []struct {
		name  string
		plain string
		why   string
	}{
		{
			name:  "empty",
			plain: "",
			why:   "an empty password must be refused at hash time, so no account can ever be created with one",
		},
		{
			name:  "one byte over the limit",
			plain: strings.Repeat("a", MaxPasswordLength+1),
			why:   "an unbounded password is a cheap way to make the server do unbounded work in a 64 MiB KDF",
		},
		{
			name:  "wildly over the limit",
			plain: strings.Repeat("a", 1<<20),
			why:   "a megabyte password must be rejected before it reaches the KDF, not after",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := HashPassword(tt.plain)
			if err == nil {
				t.Fatal(tt.why)
			}
			if code := platform.CodeOf(err); code != platform.CodeValidation {
				t.Errorf("got code %s, want %s: bad input is the caller's mistake and must be reportable against the field", code, platform.CodeValidation)
			}
		})
	}
}

func TestHashPassword_AcceptsExactlyTheLimit(t *testing.T) {
	pw := strings.Repeat("a", MaxPasswordLength)

	encoded, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("a password of exactly MaxPasswordLength bytes must be accepted, the bound is inclusive: %v", err)
	}
	ok, err := VerifyPassword(encoded, pw)
	if err != nil || !ok {
		t.Errorf("a password at the limit must verify (ok=%v, err=%v)", ok, err)
	}
}

func TestVerifyPassword_RejectsOverlongCandidate(t *testing.T) {
	encoded, err := HashPassword("something short")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	ok, err := VerifyPassword(encoded, strings.Repeat("a", MaxPasswordLength+1))
	if ok {
		t.Error("an overlong candidate must never verify")
	}
	if err == nil {
		t.Fatal("the length bound must be enforced on login too: the login endpoint is the unauthenticated one")
	}
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Errorf("got code %s, want %s", code, platform.CodeValidation)
	}
}

func TestVerifyPassword_EmptyCandidateNeverMatches(t *testing.T) {
	encoded, err := HashPassword("a real password")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	ok, err := VerifyPassword(encoded, "")
	if err != nil {
		t.Fatalf("an empty submitted password is a failed login, not a malformed request: %v", err)
	}
	if ok {
		t.Error("the empty password must never verify: HashPassword refuses to produce a hash for it")
	}
}

func TestVerifyPassword_MalformedEncodingIsAnErrorNotAMatch(t *testing.T) {
	valid, err := HashPassword("anything")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	truncated := valid[:len(valid)-8]
	wrongAlgorithm := "$argon2i$" + strings.SplitN(valid, "$", 3)[2]

	// Padded standard base64 in the salt segment: byte-for-byte a different encoding of the
	// same salt, which is exactly the kind of near-miss strict decoding is there to catch.
	field := strings.Split(valid, "$")
	field[4] = base64.StdEncoding.EncodeToString(make([]byte, argonSaltLength+1))
	paddedSalt := strings.Join(field, "$")

	tests := []struct {
		name    string
		encoded string
		why     string
	}{
		{"empty", "", "an empty hash column must not be treated as a hash"},
		{"truncated", truncated, "a hash truncated by a short column or a bad copy must not verify against anything"},
		{"wrong algorithm", wrongAlgorithm, "argon2i is a weaker function than the one we promised to store credentials under and must be refused outright"},
		{"garbage", "not a hash at all", "arbitrary rubbish must produce an error, never a panic"},
		{"no leading dollar", strings.TrimPrefix(valid, "$"), "the PHC format is fixed; a near-miss is still a miss"},
		{"too many fields", valid + "$extra", "trailing fields must not be silently ignored"},
		{"unknown version", strings.Replace(valid, "v=19", "v=16", 1), "a hash from an argon2 version we cannot reproduce must not be guessed at"},
		{"non-numeric cost", strings.Replace(valid, "t=3", "t=three", 1), "a cost parameter that is not a number must not fall back to a default"},
		{"trailing rubbish in cost", strings.Replace(valid, "t=3", "t=3x", 1), "strconv must reject what fmt.Sscanf would have skipped over"},
		{"zero time cost", strings.Replace(valid, "t=3", "t=0", 1), "argon2.IDKey panics on a zero time cost, so the parser must reject it first"},
		{"zero parallelism", strings.Replace(valid, "p=2", "p=0", 1), "argon2.IDKey panics on zero parallelism, so the parser must reject it first"},
		{"absurd memory cost", strings.Replace(valid, "m=65536", "m=4294967295", 1), "a 4 TiB memory parameter must be refused rather than allocated"},
		{"padded base64 salt", paddedSalt, "padded base64 is not the reference encoding and must not be accepted as an alternative spelling of a salt"},
		{"undecodable hash", valid[:strings.LastIndex(valid, "$")+1] + "!!!!", "a hash segment that is not base64 must error"},
		{"empty hash segment", valid[:strings.LastIndex(valid, "$")+1], "a hash of zero bytes would compare equal to a zero-length candidate"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ok, err := VerifyPassword(tt.encoded, "anything")
			if ok {
				t.Error("a malformed hash must NEVER verify: " + tt.why)
			}
			if err == nil {
				t.Error("a malformed hash must be reported as an error so it is not mistaken for a wrong password: " + tt.why)
			}
		})
	}
}

func TestVerifyPassword_HonoursTheParametersInTheHash(t *testing.T) {
	// A hash written under old, cheaper parameters must keep verifying under those
	// parameters. Verifying it under today's constants would lock every existing user out
	// the moment the cost is raised.
	const pw = "written under the old cost"
	salt := []byte("0123456789abcdef")
	oldMemory, oldTime, oldParallelism := uint32(8*1024), uint32(1), uint8(1)
	key := argon2.IDKey([]byte(pw), salt, oldTime, oldMemory, oldParallelism, argonKeyLength)
	encoded := encodePHC(oldMemory, oldTime, oldParallelism, salt, key)

	ok, err := VerifyPassword(encoded, pw)
	if err != nil {
		t.Fatalf("a hash at legacy cost parameters must still parse: %v", err)
	}
	if !ok {
		t.Error("a hash must be verified under the cost parameters it was written with, or raising the cost logs everybody out")
	}
}

func TestNeedsRehash(t *testing.T) {
	current, err := HashPassword("current")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	legacy := encodePHC(8*1024, 1, 1, make([]byte, argonSaltLength), make([]byte, argonKeyLength))
	shortSalt := encodePHC(argonMemory, argonTime, argonParallelism, make([]byte, 8), make([]byte, argonKeyLength))
	shortKey := encodePHC(argonMemory, argonTime, argonParallelism, make([]byte, argonSaltLength), make([]byte, 16))

	tests := []struct {
		name    string
		encoded string
		want    bool
		why     string
	}{
		{"current parameters", current, false, "a hash already at today's cost must not be rewritten on every single login"},
		{"cheaper parameters", legacy, true, "a hash below today's cost is exactly what NeedsRehash exists to find"},
		{"short salt", shortSalt, true, "a salt shorter than today's must be upgraded like any other weakened parameter"},
		{"short key", shortKey, true, "a derived key shorter than today's must be upgraded like any other weakened parameter"},
		{"malformed", "not a hash", true, "an unparseable hash is only ever reached after a successful verify, which it cannot produce; true keeps the function total"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NeedsRehash(tt.encoded); got != tt.want {
				t.Errorf("NeedsRehash = %v, want %v: %s", got, tt.want, tt.why)
			}
		})
	}
}

func TestHashPassword_EncodingIsThePortablePHCString(t *testing.T) {
	const pw = "portability matters"

	encoded, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	const wantPrefix = "$argon2id$v=19$m=65536,t=3,p=2$"
	if !strings.HasPrefix(encoded, wantPrefix) {
		t.Fatalf("got %q, want prefix %q: the stored value must be readable by any off-the-shelf argon2 library", encoded, wantPrefix)
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 {
		t.Fatalf("got %d segments, want 6: the PHC layout is $alg$v$params$salt$hash", len(parts))
	}
	for _, segment := range parts[4:] {
		if strings.Contains(segment, "=") {
			t.Errorf("segment %q is padded; the reference implementation emits raw base64 and padding here would make our hashes non-portable", segment)
		}
	}

	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil {
		t.Fatalf("salt segment must be raw standard base64: %v", err)
	}
	if len(salt) != argonSaltLength {
		t.Errorf("got a %d-byte salt, want %d", len(salt), argonSaltLength)
	}

	hash, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil {
		t.Fatalf("hash segment must be raw standard base64: %v", err)
	}
	if uint32(len(hash)) != argonKeyLength {
		t.Errorf("got a %d-byte key, want %d", len(hash), argonKeyLength)
	}

	// The portability claim in the doc comment is only true if the encoded fields really do
	// describe a plain argon2.IDKey call. Recompute it the way a foreign library would.
	independent := argon2.IDKey([]byte(pw), salt, argonTime, argonMemory, argonParallelism, argonKeyLength)
	if string(independent) != string(hash) {
		t.Error("an independent argon2id call over the encoded salt and parameters must reproduce the encoded hash, otherwise the PHC string is a lie")
	}
}
