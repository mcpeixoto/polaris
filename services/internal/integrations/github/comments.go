package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

// CommentClient posts linkback comments through GitHub's REST API.
type CommentClient struct {
	HTTP *http.Client
}

func (c CommentClient) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second}
}

// Post writes a comment on a pull request or a commit. An empty token is the supported
// self-hosted state: linking still works, the comment is skipped.
func (c CommentClient) Post(ctx context.Context, token string, comment domain.GitHubComment) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	path, err := commentPath(comment)
	if err != nil {
		return err
	}
	body, err := json.Marshal(map[string]string{"body": comment.Body})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.github.com"+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	res, err := c.client().Do(req)
	if err != nil {
		return fmt.Errorf("github comment: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("github comment: HTTP %d", res.StatusCode)
	}
	return nil
}

func commentPath(comment domain.GitHubComment) (string, error) {
	repo := strings.Trim(comment.Repo, "/")
	if repo == "" || strings.Count(repo, "/") != 1 {
		return "", fmt.Errorf("github comment: bad repo %q", comment.Repo)
	}
	if comment.Number > 0 {
		return fmt.Sprintf("/repos/%s/issues/%d/comments", repo, comment.Number), nil
	}
	if comment.SHA != "" {
		return fmt.Sprintf("/repos/%s/commits/%s/comments", repo, comment.SHA), nil
	}
	return "", fmt.Errorf("github comment: missing pull number and sha")
}
