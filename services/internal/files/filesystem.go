package files

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Filesystem keeps objects under a root directory. Default for self-host and for a single
// cloud box that has not moved to object storage yet.
type Filesystem struct {
	root string
}

// NewFilesystem creates the root if missing. Empty path defaults to a local data/files
// directory so `make api` works with no env; production compose sets an absolute volume.
func NewFilesystem(root string) (*Filesystem, error) {
	trimmed := strings.TrimSpace(root)
	if trimmed == "" {
		trimmed = "data/files"
	}
	abs, err := filepath.Abs(trimmed)
	if err != nil {
		return nil, fmt.Errorf("files path: %w", err)
	}
	if err := os.MkdirAll(abs, 0o750); err != nil {
		return nil, fmt.Errorf("create files root: %w", err)
	}
	return &Filesystem{root: abs}, nil
}

func (f *Filesystem) resolve(key string) (string, error) {
	if key == "" || strings.Contains(key, "..") || strings.HasPrefix(key, "/") {
		return "", fmt.Errorf("invalid storage key")
	}
	full := filepath.Join(f.root, filepath.FromSlash(key))
	// Stay inside the root even if a future caller builds a key with separators we did not
	// expect: Join alone is not enough on every OS when the key is absolute after cleaning.
	rel, err := filepath.Rel(f.root, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid storage key")
	}
	return full, nil
}

func (f *Filesystem) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	full, err := f.resolve(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(full), ".upload-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := io.Copy(tmp, r); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, full); err != nil {
		return err
	}
	ok = true
	return nil
}

func (f *Filesystem) Open(_ context.Context, key string) (io.ReadCloser, error) {
	full, err := f.resolve(key)
	if err != nil {
		return nil, err
	}
	return os.Open(full)
}

func (f *Filesystem) Delete(_ context.Context, key string) error {
	full, err := f.resolve(key)
	if err != nil {
		return err
	}
	err = os.Remove(full)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
