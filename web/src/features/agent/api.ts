/**
 * The agent's read and write path: `gql` in, plain objects out.
 *
 * Everything else in this client reads from the replica and writes through `SyncEngine`.
 * The agent does neither, on purpose. A session is private to the person who opened it and
 * carries no change rows, so there is no entity for an optimistic write to reconcile
 * against and no delta to correct a stale read — `engine.mutate` would be asked to track an
 * outbox entry that nothing will ever acknowledge. So the panel talks to the API directly
 * and holds what it gets in React state, and this file is the only place that knows the
 * shape of the wire.
 *
 * Nothing here is optimistic, and that is the right trade for this surface: an agent turn
 * is a request to a model that takes seconds, so the round trip is not the latency the user
 * notices. The one thing drawn before the server answers is the person's own message, and
 * the server returns that too.
 */

import {
  APPLY_AGENT_PROPOSAL,
  AGENT_CONFIG,
  AGENT_SESSIONS,
  AGENT_THREAD,
  CREATE_AGENT_SESSION,
  DELETE_AGENT_SESSION,
  REJECT_AGENT_PROPOSAL,
  SEND_AGENT_MESSAGE,
} from '~/gql/operations';
import type { UUID } from '~/store';
import { gql } from '~/sync/api';

/**
 * Where a session is in its cycle.
 *
 * `queued` and `working` are both "a run is in flight" as far as this client is concerned —
 * the difference is whether a worker has picked it up, which is the server's business. The
 * panel asks `isRunning` rather than comparing to either.
 */
export type AgentStatus = 'idle' | 'queued' | 'working' | 'failed';

/** Whether a run is outstanding: the composer is shut and the transcript is polled. */
export function isRunning(status: AgentStatus): boolean {
  return status === 'queued' || status === 'working';
}

export type AgentProposalState = 'pending' | 'applied' | 'rejected';

export interface AgentSession {
  readonly id: UUID;
  readonly title: string;
  readonly status: AgentStatus;
  /** Why the last run stopped. Only meaningful while `status` is `failed`. */
  readonly error: string | null;
  /** `chat`, or `comment` when the agent was summoned by a mention on an issue. */
  readonly origin: string;
  readonly issueId: UUID | null;
  readonly commentId: UUID | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentToolCall {
  readonly name: string;
  readonly summary: string;
  readonly isError: boolean;
}

export interface AgentProposalStep {
  readonly tool: string;
  readonly description: string;
  readonly arguments: unknown;
}

export interface AgentProposal {
  readonly summary: string;
  readonly steps: readonly AgentProposalStep[];
}

export interface AgentMessage {
  readonly id: UUID;
  readonly sessionId: UUID;
  readonly role: string;
  readonly body: string;
  readonly toolCalls: readonly AgentToolCall[];
  readonly proposal: AgentProposal | null;
  readonly proposalState: AgentProposalState | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly createdAt: string;
}

export interface AgentConfig {
  /** False when no model provider is configured on this deployment. */
  readonly enabled: boolean;
  readonly model: string;
  /** Credits left in whole micros, or null where the deployment does not meter. */
  readonly creditsRemaining: number | null;
}

/**
 * A live transport for one session, for when token streaming is wired up.
 *
 * The server can already stream a turn as it is produced; nothing in this client subscribes
 * to it yet, so the panel polls. `useAgentChat` takes one of these and, while it is
 * connected, stops polling — the subscriber calls `onChanged` when there is something new
 * to fetch, which is exactly what the poll timer does today. Wiring the stream up is
 * therefore implementing this interface and passing it in, and touches nothing else.
 */
export interface AgentStream {
  subscribe(sessionId: UUID, onChanged: () => void): () => void;
}

/** How many conversations the list offers. Older ones are reachable by not deleting them. */
export const SESSION_LIMIT = 30;

/**
 * How often a running session is re-read.
 *
 * A turn takes seconds, so this is not a race to the first token — it is the interval at
 * which "still working" stops being true. Fast enough that a finished answer does not sit
 * behind a spinner, slow enough that a long tool run is not a request per second.
 */
export const POLL_INTERVAL_MS = 1500;

export async function fetchAgentConfig(signal?: AbortSignal): Promise<AgentConfig> {
  const data = await gql<{ agentConfig: WireConfig }>(AGENT_CONFIG, undefined, { signal });
  return {
    enabled: data.agentConfig.enabled,
    model: data.agentConfig.model,
    creditsRemaining: data.agentConfig.creditsRemaining ?? null,
  };
}

export async function fetchAgentSessions(signal?: AbortSignal): Promise<readonly AgentSession[]> {
  const data = await gql<{ agentSessions: WireSession[] }>(
    AGENT_SESSIONS,
    { limit: SESSION_LIMIT },
    { signal },
  );
  return data.agentSessions.map(session);
}

export interface AgentThread {
  readonly sessions: readonly AgentSession[];
  readonly messages: readonly AgentMessage[];
}

export async function fetchAgentThread(
  sessionId: UUID,
  signal?: AbortSignal,
): Promise<AgentThread> {
  const data = await gql<{ agentSessions: WireSession[]; agentMessages: WireMessage[] }>(
    AGENT_THREAD,
    { sessionId, limit: SESSION_LIMIT },
    { signal },
  );
  return { sessions: data.agentSessions.map(session), messages: data.agentMessages.map(message) };
}

export interface StartedSession {
  readonly session: AgentSession;
  readonly message: AgentMessage;
}

export async function createAgentSession(body: string): Promise<StartedSession> {
  const data = await gql<{
    createAgentSession: { session: WireSession; message: WireMessage };
  }>(CREATE_AGENT_SESSION, { input: { body } });
  return {
    session: session(data.createAgentSession.session),
    message: message(data.createAgentSession.message),
  };
}

export async function sendAgentMessage(sessionId: UUID, body: string): Promise<AgentMessage> {
  const data = await gql<{ sendAgentMessage: { message: WireMessage } }>(SEND_AGENT_MESSAGE, {
    sessionId,
    body,
  });
  return message(data.sendAgentMessage.message);
}

export interface AppliedProposal {
  readonly message: AgentMessage;
  /** What the approved steps created or changed, one human-readable line each. */
  readonly applied: readonly string[];
}

export async function applyAgentProposal(messageId: UUID): Promise<AppliedProposal> {
  const data = await gql<{
    applyAgentProposal: { message: WireMessage; applied: string[] };
  }>(APPLY_AGENT_PROPOSAL, { messageId });
  return {
    message: message(data.applyAgentProposal.message),
    applied: data.applyAgentProposal.applied,
  };
}

export async function rejectAgentProposal(messageId: UUID): Promise<AgentMessage> {
  const data = await gql<{ rejectAgentProposal: { message: WireMessage } }>(REJECT_AGENT_PROPOSAL, {
    messageId,
  });
  return message(data.rejectAgentProposal.message);
}

export async function deleteAgentSession(id: UUID): Promise<void> {
  await gql<{ deleteAgentSession: { id: UUID } }>(DELETE_AGENT_SESSION, { id });
}

/**
 * What the wire actually carries.
 *
 * `status` and `proposalState` are `String` in the schema rather than enums, so they are
 * narrowed here — once, at the edge — instead of being cast at each of the dozen places
 * that branch on them. An unrecognised status reads as `idle`, which fails towards a panel
 * that lets you type rather than one stuck behind a spinner for a state it cannot name.
 */
interface WireSession {
  id: UUID;
  title: string;
  status: string;
  error: string | null;
  origin: string;
  issueId: UUID | null;
  commentId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

interface WireMessage {
  id: UUID;
  sessionId: UUID;
  role: string;
  body: string;
  toolCalls: AgentToolCall[];
  proposal: { summary: string; steps: AgentProposalStep[] } | null;
  proposalState: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

interface WireConfig {
  enabled: boolean;
  model: string;
  creditsRemaining: number | null;
}

const STATUSES: readonly AgentStatus[] = ['idle', 'queued', 'working', 'failed'];
const PROPOSAL_STATES: readonly AgentProposalState[] = ['pending', 'applied', 'rejected'];

function session(raw: WireSession): AgentSession {
  const found = STATUSES.find((one) => one === raw.status);
  return { ...raw, status: found ?? 'idle' };
}

function message(raw: WireMessage): AgentMessage {
  const state = PROPOSAL_STATES.find((one) => one === raw.proposalState);
  return { ...raw, proposalState: state ?? null };
}
