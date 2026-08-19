package github

import (
	"context"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

func TestCommentClient_EmptyTokenIsANoop(t *testing.T) {
	t.Parallel()
	c := CommentClient{}
	if err := c.Post(context.Background(), "", domain.GitHubComment{Repo: "acme/app", Number: 1, Body: "x"}); err != nil {
		t.Fatalf("empty token: %v", err)
	}
}

func TestCommentPath(t *testing.T) {
	t.Parallel()
	got, err := commentPath(domain.GitHubComment{Repo: "acme/app", Number: 12, Body: "hi"})
	if err != nil {
		t.Fatalf("path: %v", err)
	}
	if got != "/repos/acme/app/issues/12/comments" {
		t.Fatalf("pr path: %q", got)
	}
	got, err = commentPath(domain.GitHubComment{Repo: "acme/app", SHA: "abc", Body: "hi"})
	if err != nil {
		t.Fatalf("path: %v", err)
	}
	if got != "/repos/acme/app/commits/abc/comments" {
		t.Fatalf("commit path: %q", got)
	}
}
