package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	slackin "github.com/peixotolabs/polaris/services/internal/integrations/slack"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

const slackMaxBody = 1 << 20

type slackHandlers struct {
	svc           *domain.Service
	signingSecret string
	botToken      string
	publicURL     string
	unfurl        func(ctx context.Context, botToken string, body []byte) error
}

func (h *slackHandlers) command(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := uuid.Parse(r.PathValue("workspaceId"))
	if err != nil {
		writeError(w, r, platform.Validation("workspaceId", "not a workspace id"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, slackMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not read the request body"))
		return
	}
	if err := h.svc.VerifySlackRequest(
		r.Context(), workspaceID, body,
		r.Header.Get("X-Slack-Request-Timestamp"),
		r.Header.Get("X-Slack-Signature"),
		h.signingSecret,
	); err != nil {
		writeError(w, r, err)
		return
	}
	form, err := url.ParseQuery(string(body))
	if err != nil {
		writeError(w, r, platform.Validation("", "could not parse the Slack command"))
		return
	}
	result, err := h.svc.HandleSlackSlash(r.Context(), workspaceID, slackin.ParseSlash(form), h.publicURL)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"response_type": "ephemeral",
		"text":          result.Text,
	})
}

func (h *slackHandlers) events(w http.ResponseWriter, r *http.Request) {
	workspaceID, err := uuid.Parse(r.PathValue("workspaceId"))
	if err != nil {
		writeError(w, r, platform.Validation("workspaceId", "not a workspace id"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, slackMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not read the request body"))
		return
	}

	env, err := slackin.ParseEvent(body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not parse the Slack event"))
		return
	}
	if env.Type == "url_verification" {
		if !platform.SlackTimestampOK(r.Header.Get("X-Slack-Request-Timestamp"), time.Now()) ||
			!platform.SlackSignatureOK(h.signingSecret, r.Header.Get("X-Slack-Request-Timestamp"), body, r.Header.Get("X-Slack-Signature")) {
			writeError(w, r, platform.Unauthorized("bad slack signature"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"challenge": env.Challenge})
		return
	}

	if err := h.svc.VerifySlackRequest(
		r.Context(), workspaceID, body,
		r.Header.Get("X-Slack-Request-Timestamp"),
		r.Header.Get("X-Slack-Signature"),
		h.signingSecret,
	); err != nil {
		writeError(w, r, err)
		return
	}

	switch env.Event.Type {
	case "link_shared":
		urls := make([]string, 0, len(env.Event.Links))
		for _, link := range env.Event.Links {
			urls = append(urls, link.URL)
		}
		cards, err := h.svc.SlackUnfurls(r.Context(), workspaceID, urls, h.publicURL)
		if err != nil {
			writeError(w, r, err)
			return
		}
		if len(cards) > 0 && strings.TrimSpace(h.botToken) != "" {
			payload, err := slackin.EncodeUnfurl(env.Event.Channel, env.Event.MessageTS, cards)
			if err != nil {
				writeError(w, r, platform.Internal(err))
				return
			}
			post := h.unfurl
			if post == nil {
				post = postSlackUnfurl
			}
			if err := post(r.Context(), h.botToken, payload); err != nil {
				platform.Log(r.Context()).Warn("slack unfurl failed", "error", err)
			}
		}
	case "message":
		if err := h.svc.HandleSlackMessage(r.Context(), workspaceID, env.Event); err != nil {
			writeError(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func postSlackUnfurl(ctx context.Context, botToken string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://slack.com/api/chat.unfurl", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("slack chat.unfurl: HTTP %d", resp.StatusCode)
	}
	return nil
}
