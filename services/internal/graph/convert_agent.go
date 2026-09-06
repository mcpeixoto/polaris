package graph

import (
	"context"
	"encoding/json"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// ------------------------------------------------------------------------------- agent

func toAgentSession(s model.AgentSession) generated.AgentSession {
	return generated.AgentSession{
		ID:          s.ID,
		WorkspaceID: s.WorkspaceID,
		UserID:      s.UserID,
		Title:       s.Title,
		Status:      s.Status,
		Error:       s.Error,
		Origin:      s.Origin,
		IssueID:     s.IssueID,
		CommentID:   s.CommentID,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
	}
}

func toAgentSessions(rows []model.AgentSession) []generated.AgentSession {
	out := make([]generated.AgentSession, 0, len(rows))
	for _, s := range rows {
		out = append(out, toAgentSession(s))
	}
	return out
}

func toAgentMessage(m model.AgentMessage) generated.AgentMessage {
	out := generated.AgentMessage{
		ID:            m.ID,
		WorkspaceID:   m.WorkspaceID,
		SessionID:     m.SessionID,
		Role:          m.Role,
		Body:          m.Body,
		ToolCalls:     make([]generated.AgentToolCall, 0, len(m.ToolCalls)),
		ProposalState: m.ProposalState,
		InputTokens:   m.InputTokens,
		OutputTokens:  m.OutputTokens,
		CreatedAt:     m.CreatedAt,
	}
	for _, call := range m.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, generated.AgentToolCall{
			Name: call.Name, Summary: call.Summary, IsError: call.IsError,
		})
	}
	if m.Proposal != nil {
		steps := make([]generated.AgentProposalStep, 0, len(m.Proposal.Steps))
		for _, step := range m.Proposal.Steps {
			args := step.Arguments
			if args == nil {
				// The JSON scalar is non-null on the field. A step that takes no arguments
				// is an empty object, not a null the client has to guard.
				args = map[string]any{}
			}
			raw, err := json.Marshal(args)
			if err != nil {
				// Arguments that will not marshal came from a row that should not exist.
				// An empty object keeps the transcript readable; the step is still named.
				raw = []byte("{}")
			}
			steps = append(steps, generated.AgentProposalStep{
				Tool: step.Tool, Description: step.Description, Arguments: raw,
			})
		}
		out.Proposal = &generated.AgentProposal{Summary: m.Proposal.Summary, Steps: steps}
	}
	return out
}

func toAgentMessages(rows []model.AgentMessage) []generated.AgentMessage {
	out := make([]generated.AgentMessage, 0, len(rows))
	for _, m := range rows {
		out = append(out, toAgentMessage(m))
	}
	return out
}

// agentConfig answers what the chat surface needs before it offers itself: whether there is
// a provider at all, which model is answering, what is left to spend, and whether this
// person has turned the confirmation step off.
//
// Reported up front rather than discovered from a failed send — a surface that offers a
// chat box and then answers "no provider configured" has already wasted the question
// somebody typed.
func (r *Resolver) agentConfig(
	ctx context.Context, p *authz.Principal, autoApply bool,
) (*generated.AgentConfig, error) {
	credits, err := r.Svc.AgentCreditsRemaining(ctx, p)
	if err != nil {
		return nil, PresentError(ctx, err)
	}
	out := &generated.AgentConfig{
		Enabled:   r.AgentProvider != "",
		Model:     r.AgentProvider,
		AutoApply: autoApply,
	}
	if credits != nil {
		// Null means this deployment does not meter, which the client renders as no limit
		// rather than none left.
		remaining := int(*credits)
		out.CreditsRemaining = &remaining
	}
	return out, nil
}
