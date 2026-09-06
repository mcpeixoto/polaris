// Package agent runs the in-app agent: it turns a conversation into tool calls, and turns
// an approved proposal into writes.
//
// It sits above internal/domain and internal/agent/tools and below the transports, so the
// same runner serves an interactive request on the api and a queued run on the worker.
// Nothing here holds a database handle of its own — every write goes through domain, with
// the caller's own principal, so an agent can reach exactly what the person behind it can
// and nothing more.
package agent

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/agent/tools"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Executor applies proposals. Separate from the model-calling half so that approving work
// the agent already planned needs no provider configured and no API key present: a
// deployment that turns the agent off must still be able to finish what it started.
type Executor struct {
	Svc   *domain.Service
	Tools *tools.Registry
}

func NewExecutor(svc *domain.Service) *Executor {
	return &Executor{Svc: svc, Tools: tools.New()}
}

// ApplyProposal carries out the steps a turn proposed, as the approving user.
//
// The proposal is marked applied **before** anything runs. That ordering is deliberate: the
// mark is a conditional update on the row still being pending, so it doubles as the lock
// that makes approval single-shot. Running first and marking after would leave a window in
// which a double click, a retried request or two open tabs each create the same three
// issues — and duplicated writes are a far worse failure than a proposal recorded as
// applied when one of its steps failed, which is at least visible and explained.
func (e *Executor) ApplyProposal(
	ctx context.Context, p *authz.Principal, messageID uuid.UUID,
) (model.AgentMessage, []string, int64, error) {
	message, _, err := e.Svc.GetAgentMessageForOwner(ctx, p, messageID)
	if err != nil {
		return model.AgentMessage{}, nil, 0, err
	}
	if message.Proposal == nil {
		return model.AgentMessage{}, nil, 0, platform.Validation("messageId", "that turn proposed nothing")
	}
	if message.ProposalState == nil || *message.ProposalState != domain.AgentProposalPending {
		return model.AgentMessage{}, nil, 0, platform.Conflict("that proposal has already been decided")
	}

	marked, version, err := e.Svc.MarkAgentProposal(ctx, p, messageID, domain.AgentProposalApplied)
	if err != nil {
		return model.AgentMessage{}, nil, 0, err
	}

	applied := make([]string, 0, len(message.Proposal.Steps))
	for i, step := range message.Proposal.Steps {
		tool, ok := e.Tools.Get(step.Tool)
		if !ok {
			// The proposal named a tool this build does not have — an older proposal
			// approved after an upgrade removed it. Stop rather than skip: the remaining
			// steps may depend on this one.
			return marked, applied, version, platform.Validation(
				"proposal", fmt.Sprintf("step %d uses %q, which this version no longer has", i+1, step.Tool))
		}
		if tool.ReadOnly {
			// A read has no business in a proposal: proposals exist to gate writes, and a
			// read that reached one means the run built it wrong.
			continue
		}
		if _, err := tool.Run(ctx, e.Svc, p, step.Arguments); err != nil {
			return marked, applied, version, platform.Validation(
				"proposal", fmt.Sprintf("step %d (%s) failed: %s", i+1, step.Tool, err.Error()))
		}
		applied = append(applied, describeStep(step))
	}
	return marked, applied, version, nil
}

// RejectProposal declines the writes. The turn stays in the transcript so the conversation
// still reads as a conversation — a rejected plan is context for the next question.
func (e *Executor) RejectProposal(
	ctx context.Context, p *authz.Principal, messageID uuid.UUID,
) (model.AgentMessage, int64, error) {
	return e.Svc.MarkAgentProposal(ctx, p, messageID, domain.AgentProposalRejected)
}

func describeStep(step model.AgentProposalStep) string {
	if d := strings.TrimSpace(step.Description); d != "" {
		return d
	}
	return step.Tool
}
