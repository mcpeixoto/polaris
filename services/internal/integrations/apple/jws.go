// Package apple verifies a StoreKit 2 signed transaction.
//
// The client sends the JWS Apple signed. This package checks that signature against
// Apple's root and reads the payload. It does not decide what a workspace is entitled
// to — that is domain.ApplyAppStoreTransaction, which is the only caller that should
// trust a Transaction value.
package apple

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// Product identifiers for Cloud Pro. The iOS app requests these same strings from
// StoreKit; a mismatch is a purchase the server will not honour.
const (
	BundleID       = "com.peixotolabs.polaris"
	ProductMonthly = "com.peixotolabs.polaris.pro.monthly"
	ProductYearly  = "com.peixotolabs.polaris.pro.yearly"
)

// IsCloudPro reports whether productID is one of the two Cloud Pro subscriptions.
func IsCloudPro(productID string) bool {
	return productID == ProductMonthly || productID == ProductYearly
}

// Transaction is the part of a signed StoreKit 2 transaction this product acts on.
type Transaction struct {
	BundleID              string
	ProductID             string
	OriginalTransactionID string
	Environment           string
	ExpiresAt             time.Time
	Revoked               bool
}

//go:embed AppleRootCA-G3.crt
var appleRootPEM []byte

// ProductionRoots is Apple's App Store root. Tests pass their own pool to ParseWithRoots.
func ProductionRoots() *x509.CertPool {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(appleRootPEM) {
		// The file is embedded from Apple's published root. Failing to parse it is a
		// build that cannot verify any purchase, which is worse than a later request
		// error because every call would fail the same way.
		panic("apple: embedded root certificate did not parse")
	}
	return pool
}

// Parse verifies jws against Apple's root.
func Parse(jws string) (Transaction, error) {
	return ParseWithRoots(jws, ProductionRoots())
}

// ParseWithRoots verifies jws against roots. Tests use it with a certificate they minted.
func ParseWithRoots(jws string, roots *x509.CertPool) (Transaction, error) {
	payload, err := verify(jws, roots)
	if err != nil {
		return Transaction{}, err
	}
	var raw struct {
		BundleID              string `json:"bundleId"`
		ProductID             string `json:"productId"`
		OriginalTransactionID string `json:"originalTransactionId"`
		Environment           string `json:"environment"`
		ExpiresDate           int64  `json:"expiresDate"`
		RevocationDate        int64  `json:"revocationDate"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return Transaction{}, fmt.Errorf("apple: transaction payload: %w", err)
	}
	if raw.BundleID == "" || raw.ProductID == "" || raw.OriginalTransactionID == "" {
		return Transaction{}, errors.New("apple: transaction is missing bundle, product or original transaction id")
	}
	tx := Transaction{
		BundleID:              raw.BundleID,
		ProductID:             raw.ProductID,
		OriginalTransactionID: raw.OriginalTransactionID,
		Environment:           raw.Environment,
		Revoked:               raw.RevocationDate != 0,
	}
	if raw.ExpiresDate != 0 {
		tx.ExpiresAt = time.UnixMilli(raw.ExpiresDate).UTC()
	}
	return tx, nil
}

func verify(jws string, roots *x509.CertPool) ([]byte, error) {
	parts := strings.Split(jws, ".")
	if len(parts) != 3 {
		return nil, errors.New("apple: transaction is not a JWS")
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("apple: transaction header: %w", err)
	}
	var header struct {
		Alg string   `json:"alg"`
		X5c []string `json:"x5c"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, fmt.Errorf("apple: transaction header: %w", err)
	}
	if header.Alg != "ES256" {
		return nil, fmt.Errorf("apple: transaction algorithm %q", header.Alg)
	}
	if len(header.X5c) == 0 {
		return nil, errors.New("apple: transaction has no certificate chain")
	}
	certs := make([]*x509.Certificate, len(header.X5c))
	for i, encoded := range header.X5c {
		der, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("apple: certificate %d: %w", i, err)
		}
		certs[i], err = x509.ParseCertificate(der)
		if err != nil {
			return nil, fmt.Errorf("apple: certificate %d: %w", i, err)
		}
	}
	intermediates := x509.NewCertPool()
	for _, cert := range certs[1:] {
		intermediates.AddCert(cert)
	}
	if _, err := certs[0].Verify(x509.VerifyOptions{
		Roots:         roots,
		Intermediates: intermediates,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}); err != nil {
		return nil, fmt.Errorf("apple: certificate chain: %w", err)
	}
	pub, ok := certs[0].PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, errors.New("apple: leaf certificate is not an ECDSA key")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("apple: transaction signature: %w", err)
	}
	if !verifyES256(pub, sha256Sum(parts[0]+"."+parts[1]), sig) {
		return nil, errors.New("apple: transaction signature does not match")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("apple: transaction payload: %w", err)
	}
	return payload, nil
}

func sha256Sum(signed string) []byte {
	sum := sha256.Sum256([]byte(signed))
	return sum[:]
}

// JWS ES256 signatures are R || S, 32 octets each, not ASN.1.
func verifyES256(pub *ecdsa.PublicKey, digest, sig []byte) bool {
	if len(sig) != 64 {
		return false
	}
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	return ecdsa.Verify(pub, digest, r, s)
}
