// Package files is the object-storage driver for uploaded images.
//
// Two drivers share one interface so self-host can keep bytes on a volume and cloud can
// point at MinIO or any S3-compatible store without changing the upload handlers. The
// product path always goes through this package: nothing else opens the bucket or the
// directory.
package files

import (
	"context"
	"fmt"
	"io"
	"strings"
)

// MaxBytes is the hard ceiling for one upload. Mirrored in the uploaded_file CHECK and in
// the HTTP MaxBytesReader so a client that lies about Content-Length still stops at 25 MiB.
const MaxBytes int64 = 25 << 20

// Store is the byte backend. Keys are opaque to callers — domain builds them.
type Store interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

// OpenFromConfig builds the driver named by POLARIS_FILES_DRIVER.
func OpenFromConfig(driver, path string, s3 S3Config) (Store, error) {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "", "filesystem", "fs", "local":
		return NewFilesystem(path)
	case "s3":
		return NewS3(s3)
	default:
		return nil, fmt.Errorf("POLARIS_FILES_DRIVER must be filesystem or s3, not %q", driver)
	}
}

// S3Config is the subset of S3 settings the MinIO / R2 client needs.
type S3Config struct {
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string
	Region    string
	// PathStyle forces path-style addressing. MinIO needs it; AWS S3 prefers virtual-host.
	PathStyle bool
}
