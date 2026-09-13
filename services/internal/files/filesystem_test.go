package files

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestFilesystem_RoundTrip(t *testing.T) {
	root := t.TempDir()
	store, err := NewFilesystem(root)
	if err != nil {
		t.Fatal(err)
	}

	payload := []byte("\x89PNG\r\n\x1a\nhello")
	if err := store.Put(context.Background(), "ws/ab/cdef", bytes.NewReader(payload), int64(len(payload)), "image/png"); err != nil {
		t.Fatal(err)
	}

	rc, err := store.Open(context.Background(), "ws/ab/cdef")
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(rc)
	_ = rc.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("got %q", got)
	}

	if _, err := os.Stat(filepath.Join(root, "ws", "ab", "cdef")); err != nil {
		t.Fatal(err)
	}

	if err := store.Delete(context.Background(), "ws/ab/cdef"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(context.Background(), "ws/ab/cdef"); err == nil {
		t.Fatal("expected missing object after delete")
	}
}

func TestFilesystem_RejectsTraversal(t *testing.T) {
	store, err := NewFilesystem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), "../escape", bytes.NewReader([]byte("x")), 1, "text/plain"); err == nil {
		t.Fatal("expected traversal to fail")
	}
}
