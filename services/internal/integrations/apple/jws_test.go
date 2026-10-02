package apple

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"testing"
	"time"
)

func TestParseWithRootsAcceptsAChainWeSigned(t *testing.T) {
	roots, jws := signTransaction(t, map[string]any{
		"bundleId":              BundleID,
		"productId":             ProductMonthly,
		"originalTransactionId": "1000000000000001",
		"environment":           "Sandbox",
		"expiresDate":           time.Now().Add(30 * 24 * time.Hour).UnixMilli(),
	})

	tx, err := ParseWithRoots(jws, roots)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if tx.BundleID != BundleID || tx.ProductID != ProductMonthly {
		t.Fatalf("transaction = %+v", tx)
	}
	if tx.OriginalTransactionID != "1000000000000001" {
		t.Fatalf("original transaction id = %q", tx.OriginalTransactionID)
	}
	if tx.ExpiresAt.Before(time.Now()) {
		t.Fatalf("expires at %s, which is already past", tx.ExpiresAt)
	}
	if tx.Revoked {
		t.Fatal("a transaction with no revocation date was revoked")
	}
}

func TestParseWithRootsRejectsADifferentRoot(t *testing.T) {
	_, jws := signTransaction(t, map[string]any{
		"bundleId":              BundleID,
		"productId":             ProductMonthly,
		"originalTransactionId": "1",
	})
	other, _ := signTransaction(t, map[string]any{
		"bundleId":              BundleID,
		"productId":             ProductMonthly,
		"originalTransactionId": "2",
	})
	if _, err := ParseWithRoots(jws, other); err == nil {
		t.Fatal("a transaction signed by another root was accepted")
	}
}

func TestProductionRootParses(t *testing.T) {
	if ProductionRoots() == nil {
		t.Fatal("production roots were nil")
	}
}

func TestIsCloudPro(t *testing.T) {
	if !IsCloudPro(ProductMonthly) || !IsCloudPro(ProductYearly) {
		t.Fatal("the two Cloud Pro products were not recognised")
	}
	if IsCloudPro("com.example.other") {
		t.Fatal("an unrelated product was treated as Cloud Pro")
	}
}

// signTransaction mints a root, an intermediate and a leaf, and returns a JWS whose
// x5c chain the root verifies.
func signTransaction(t *testing.T, payload map[string]any) (*x509.CertPool, string) {
	t.Helper()
	rootKey := ecdsaKey(t)
	root := certificate(t, rootKey, rootKey, nil, true)
	midKey := ecdsaKey(t)
	mid := certificate(t, midKey, rootKey, root, true)
	leafKey := ecdsaKey(t)
	leaf := certificate(t, leafKey, midKey, mid, false)

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	header, err := json.Marshal(map[string]any{
		"alg": "ES256",
		"x5c": []string{
			base64.StdEncoding.EncodeToString(leaf.Raw),
			base64.StdEncoding.EncodeToString(mid.Raw),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
	sum := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, leafKey, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	sig := append(pad32(r), pad32(s)...)
	jws := signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)

	pool := x509.NewCertPool()
	pool.AddCert(root)
	return pool, jws
}

func ecdsaKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func certificate(t *testing.T, key, parentKey *ecdsa.PrivateKey, parent *x509.Certificate, ca bool) *x509.Certificate {
	t.Helper()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(time.Now().UnixNano()),
		Subject:               pkix.Name{CommonName: "test"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  ca,
	}
	if ca {
		template.KeyUsage = x509.KeyUsageCertSign
	}
	if parent == nil {
		parent = template
	}
	der, err := x509.CreateCertificate(rand.Reader, template, parent, &key.PublicKey, parentKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

func pad32(n *big.Int) []byte {
	out := make([]byte, 32)
	b := n.Bytes()
	copy(out[32-len(b):], b)
	return out
}
