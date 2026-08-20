package gitlab

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

func TestCommentClient_EmptyTokenIsANoop(t *testing.T) {
	t.Parallel()
	c := CommentClient{}
	if err := c.Post(context.Background(), "", domain.GitLabComment{Project: "acme/app", Number: 1, Body: "x"}); err != nil {
		t.Fatalf("empty token: %v", err)
	}
}

func TestCommentRequest(t *testing.T) {
	t.Parallel()
	got, payload, err := commentRequest(domain.GitLabComment{
		InstanceURL: "https://gitlab.example",
		Project:     "acme/app",
		Number:      12,
		Body:        "hi",
	})
	if err != nil {
		t.Fatalf("path: %v", err)
	}
	if got != "https://gitlab.example/api/v4/projects/acme%2Fapp/merge_requests/12/notes" {
		t.Fatalf("mr path: %q", got)
	}
	if payload["body"] != "hi" {
		t.Fatalf("payload: %+v", payload)
	}
	got, payload, err = commentRequest(domain.GitLabComment{
		Project: "group/sub/app",
		SHA:     "abc",
		Body:    "hi",
	})
	if err != nil {
		t.Fatalf("path: %v", err)
	}
	if got != "https://gitlab.com/api/v4/projects/group%2Fsub%2Fapp/repository/commits/abc/comments" {
		t.Fatalf("commit path: %q", got)
	}
	if payload["note"] != "hi" {
		t.Fatalf("commit payload uses note, got %+v", payload)
	}
}
