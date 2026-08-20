package gitlab

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

// CommentClient posts linkback notes through GitLab's REST API.
type CommentClient struct {
	HTTP *http.Client
}

func (c CommentClient) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second}
}

// Post writes a note on a merge request or a commit. An empty token is the supported
// self-hosted state: linking still works, the comment is skipped.
func (c CommentClient) Post(ctx context.Context, token string, comment domain.GitLabComment) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	endpoint, payload, err := commentRequest(comment)
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.client().Do(req)
	if err != nil {
		return fmt.Errorf("gitlab comment: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("gitlab comment: HTTP %d", res.StatusCode)
	}
	return nil
}

func commentRequest(comment domain.GitLabComment) (string, map[string]string, error) {
	base := strings.TrimRight(strings.TrimSpace(comment.InstanceURL), "/")
	if base == "" {
		base = domain.DefaultGitLabInstanceURL
	}
	project := strings.Trim(comment.Project, "/")
	if project == "" {
		return "", nil, fmt.Errorf("gitlab comment: missing project")
	}
	encoded := url.PathEscape(project)
	if comment.Number > 0 {
		return fmt.Sprintf("%s/api/v4/projects/%s/merge_requests/%d/notes", base, encoded, comment.Number),
			map[string]string{"body": comment.Body}, nil
	}
	if comment.SHA != "" {
		return fmt.Sprintf("%s/api/v4/projects/%s/repository/commits/%s/comments", base, encoded, url.PathEscape(comment.SHA)),
			map[string]string{"note": comment.Body}, nil
	}
	return "", nil, fmt.Errorf("gitlab comment: missing merge request iid and sha")
}
