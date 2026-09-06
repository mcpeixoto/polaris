/**
 * The panel, against a stubbed wire.
 *
 * `gql` is mocked and routed by operation name, so these are tests of what the panel does
 * with an answer rather than of how it phrases the question. The four things that would be
 * expensive to get wrong are covered: a transcript that says who spoke, a proposal that is
 * actionable exactly once, a composer that cannot produce the conflict the server would
 * refuse, and a deployment with no model provider saying so instead of offering a box.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gql } from '~/sync/api';

import { AgentPanel } from './AgentPanel';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const wire = vi.mocked(gql);

const AT = '2026-01-01T00:00:00Z';

const SESSION = {
  id: 's1',
  title: 'Tidy the stale bugs',
  status: 'idle',
  error: null,
  origin: 'chat',
  issueId: null,
  commentId: null,
  createdAt: AT,
  updatedAt: AT,
};

function message(over: Record<string, unknown>) {
  return {
    id: 'm0',
    sessionId: 's1',
    role: 'assistant',
    body: '',
    toolCalls: [],
    proposal: null,
    proposalState: null,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: AT,
    ...over,
  };
}

const ASKED = message({ id: 'm1', role: 'user', body: 'Which bugs have gone stale?' });

/** What the server echoes back for a question sent from the composer. */
const FOLLOW_UP = message({ id: 'm9', role: 'user', body: 'Move them all' });

const ANSWERED = message({
  id: 'm2',
  body: 'Three bugs have not moved in a month.',
  toolCalls: [{ name: 'search_issues', summary: 'read 3 issues', isError: false }],
});

const PROPOSED = message({
  id: 'm3',
  body: 'I can move them.',
  proposal: {
    summary: 'Move 3 issues to Backlog',
    steps: [
      { tool: 'update_issue', description: 'POL-12 → Backlog', arguments: { id: 'i1' } },
      { tool: 'update_issue', description: 'POL-19 → Backlog', arguments: { id: 'i2' } },
    ],
  },
  proposalState: 'pending',
});

interface Wired {
  enabled?: boolean;
  sessions?: unknown[];
  messages?: unknown[];
  status?: string;
  /** What `applyAgentProposal` answers with. */
  applied?: string[];
}

function serve({ enabled = true, sessions, messages = [], status, applied = [] }: Wired) {
  const list = sessions ?? [status === undefined ? SESSION : { ...SESSION, status }];

  wire.mockImplementation((async (query: string) => {
    if (query.includes('query AgentConfig')) {
      return { agentConfig: { enabled, model: 'a-model', creditsRemaining: null } };
    }
    if (query.includes('query AgentSessions')) return { agentSessions: list };
    if (query.includes('query AgentThread')) {
      return { agentSessions: list, agentMessages: messages };
    }
    if (query.includes('mutation ApplyAgentProposal')) {
      return {
        applyAgentProposal: {
          version: 1,
          message: { ...PROPOSED, proposalState: 'applied' },
          applied,
        },
      };
    }
    if (query.includes('mutation RejectAgentProposal')) {
      return {
        rejectAgentProposal: {
          version: 1,
          message: { ...PROPOSED, proposalState: 'rejected' },
        },
      };
    }
    if (query.includes('mutation DeleteAgentSession')) {
      return { deleteAgentSession: { version: 1, id: 's1' } };
    }
    if (query.includes('mutation SendAgentMessage')) {
      return { sendAgentMessage: { version: 1, message: FOLLOW_UP } };
    }
    throw new Error(`unstubbed operation: ${query.slice(0, 60)}`);
  }) as unknown as typeof gql);
}

function mounted() {
  const onClose = vi.fn();
  render(<AgentPanel open onClose={onClose} />);
  return { onClose };
}

/** Opens the one seeded conversation, which is how every transcript test starts. */
async function openConversation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Tidy the stale bugs/ }));
}

beforeEach(() => {
  wire.mockReset();
});

describe('AgentPanel', () => {
  it('renders the conversation list, and opens one', async () => {
    const user = userEvent.setup();
    serve({ messages: [ASKED, ANSWERED] });
    mounted();

    await openConversation(user);

    expect(await screen.findByRole('log', { name: 'Conversation' })).not.toBeNull();
  });

  it('says who spoke, and shows the work behind an answer', async () => {
    const user = userEvent.setup();
    serve({ messages: [ASKED, ANSWERED] });
    mounted();
    await openConversation(user);

    expect(await screen.findByText('Which bugs have gone stale?')).not.toBeNull();
    expect(screen.getByText('Three bugs have not moved in a month.')).not.toBeNull();
    expect(screen.getByText('read 3 issues')).not.toBeNull();
    expect(screen.getAllByText('You')).toHaveLength(1);
    expect(screen.getAllByText('Agent')).toHaveLength(1);
  });

  it('offers a pending proposal, applies it, and reports what changed', async () => {
    const user = userEvent.setup();
    serve({ messages: [PROPOSED], applied: ['POL-12 moved to Backlog'] });
    mounted();
    await openConversation(user);

    expect(await screen.findByText('Move 3 issues to Backlog')).not.toBeNull();
    expect(screen.getByText('POL-12 → Backlog')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.getByText('POL-12 moved to Backlog')).not.toBeNull();
    });
    const applied = wire.mock.calls.filter(([query]) =>
      String(query).includes('mutation ApplyAgentProposal'),
    );
    expect(applied).toHaveLength(1);
    expect(applied[0]?.[1]).toEqual({ messageId: 'm3' });
  });

  it('does not offer a settled proposal again', async () => {
    const user = userEvent.setup();
    serve({ messages: [{ ...PROPOSED, proposalState: 'applied' }] });
    mounted();
    await openConversation(user);

    expect(await screen.findByText('Applied')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('declines a proposal, and says nothing was written', async () => {
    const user = userEvent.setup();
    serve({ messages: [PROPOSED] });
    mounted();
    await openConversation(user);

    await user.click(await screen.findByRole('button', { name: 'Decline' }));

    expect(await screen.findByText('Declined — nothing was written')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    const declined = wire.mock.calls.filter(([query]) =>
      String(query).includes('mutation RejectAgentProposal'),
    );
    expect(declined).toHaveLength(1);
    expect(declined[0]?.[1]).toEqual({ messageId: 'm3' });
  });

  it('deletes a conversation, but not on the first press', async () => {
    const user = userEvent.setup();
    serve({});
    mounted();

    await user.click(await screen.findByRole('button', { name: 'Delete Tidy the stale bugs' }));
    expect(
      wire.mock.calls.some(([query]) => String(query).includes('mutation DeleteAgentSession')),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Tidy the stale bugs/ })).toBeNull();
    });
    const deleted = wire.mock.calls.filter(([query]) =>
      String(query).includes('mutation DeleteAgentSession'),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.[1]).toEqual({ id: 's1' });
  });

  it('shuts the composer while a run is in flight', async () => {
    const user = userEvent.setup();
    serve({ status: 'working', messages: [ASKED] });
    mounted();
    await openConversation(user);

    const box = await screen.findByLabelText('Ask the agent');
    await waitFor(() => {
      expect((box as HTMLTextAreaElement).disabled).toBe(true);
    });
    expect(screen.getByText('Working…')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows why a run stopped', async () => {
    const user = userEvent.setup();
    serve({
      sessions: [{ ...SESSION, status: 'failed', error: 'The model provider timed out.' }],
      messages: [ASKED],
    });
    mounted();
    await openConversation(user);

    expect(await screen.findByText('The model provider timed out.')).not.toBeNull();
  });

  it('sends the draft and clears the box', async () => {
    const user = userEvent.setup();
    serve({ messages: [ASKED] });
    mounted();
    await openConversation(user);

    const box = await screen.findByLabelText('Ask the agent');
    await user.type(box, 'Move them all');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect((box as HTMLTextAreaElement).value).toBe('');
    });
    const sent = wire.mock.calls.filter(([query]) =>
      String(query).includes('mutation SendAgentMessage'),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.[1]).toEqual({ sessionId: 's1', body: 'Move them all' });
  });

  it('sends on Enter, and takes a newline on Shift+Enter', async () => {
    const user = userEvent.setup();
    serve({ messages: [ASKED] });
    mounted();
    await openConversation(user);

    const box = (await screen.findByLabelText('Ask the agent')) as HTMLTextAreaElement;
    await user.type(box, 'first line{Shift>}{Enter}{/Shift}second line');
    expect(box.value).toBe('first line\nsecond line');

    await user.type(box, '{Enter}');

    await waitFor(() => {
      expect(box.value).toBe('');
    });
    const sent = wire.mock.calls.filter(([query]) =>
      String(query).includes('mutation SendAgentMessage'),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.[1]).toEqual({ sessionId: 's1', body: 'first line\nsecond line' });
  });

  it('offers nothing to type in when no provider is configured', async () => {
    serve({ enabled: false });
    mounted();

    expect(await screen.findByText('The agent is not set up here')).not.toBeNull();
    expect(screen.queryByLabelText('Ask the agent')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('renders nothing at all while shut', () => {
    serve({});
    const onClose = vi.fn();
    const { container } = render(<AgentPanel open={false} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
    expect(wire).not.toHaveBeenCalled();
  });
});
