package files

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3 is an S3-compatible store (MinIO, R2, AWS).
type S3 struct {
	client *minio.Client
	bucket string
}

// NewS3 builds a client. Endpoint may be host:port or a full URL; https is assumed unless
// the scheme is http (local MinIO).
func NewS3(cfg S3Config) (*S3, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	bucket := strings.TrimSpace(cfg.Bucket)
	access := strings.TrimSpace(cfg.AccessKey)
	secret := strings.TrimSpace(cfg.SecretKey)
	if endpoint == "" || bucket == "" || access == "" || secret == "" {
		return nil, fmt.Errorf("POLARIS_S3_ENDPOINT, POLARIS_S3_BUCKET, POLARIS_S3_ACCESS_KEY and POLARIS_S3_SECRET_KEY are required when POLARIS_FILES_DRIVER=s3")
	}

	secure := true
	host := endpoint
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		host = u.Host
		if u.Scheme == "http" {
			secure = false
		}
	}

	region := strings.TrimSpace(cfg.Region)
	if region == "" {
		region = "us-east-1"
	}

	lookup := minio.BucketLookupAuto
	if cfg.PathStyle || !strings.Contains(host, "amazonaws.com") {
		lookup = minio.BucketLookupPath
	}

	client, err := minio.New(host, &minio.Options{
		Creds:        credentials.NewStaticV4(access, secret, ""),
		Secure:       secure,
		Region:       region,
		BucketLookup: lookup,
	})
	if err != nil {
		return nil, fmt.Errorf("s3 client: %w", err)
	}

	ctx := context.Background()
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("s3 bucket check: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: region}); err != nil {
			return nil, fmt.Errorf("s3 create bucket: %w", err)
		}
	}

	return &S3{client: client, bucket: bucket}, nil
}

func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	opts := minio.PutObjectOptions{ContentType: contentType}
	_, err := s.client.PutObject(ctx, s.bucket, key, r, size, opts)
	return err
}

func (s *S3) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	// Stat forces a missing-key error onto Open rather than the first Read, so a handler
	// can answer 404 before writing headers.
	if _, err := obj.Stat(); err != nil {
		_ = obj.Close()
		return nil, err
	}
	return obj, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}
