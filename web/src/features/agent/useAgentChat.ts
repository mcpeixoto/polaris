/**
 * The panel's state: what the agent knows, what it is doing, and what it wants permission
 * for.
 *
 * All of it is local to the panel. Nothing here reaches the replica, and nothing that
 * happens here shows up on another surface, which is the whole reason the agent's entities
 * were kept out of the store — see `api.ts`.
 *
 * Two rules the rest of the feature depends on:
 *
 * The composer is shut whenever a run is outstanding. The server refuses a second question
 * while the first is still being answered, and a UI that can produce a refusal it already
 * knows is coming has chosen to show the user an error instead of a disabled field.
 *
 * A running session is re-read on a timer until it settles. Polling is the transport, not
 * the design: `AgentStream` is the seam a token stream slots into, and while one is
 * connected the timer does not run.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';

import {
  applyAgentProposal,
  createAgentSession,
  deleteAgentSession,
  fetchAgentConfig,
  fetchAgentSessions,
  fetchAgentThread,
  isRunning,
  POLL_INTERVAL_MS,
  rejectAgentProposal,
  sendAgentMessage,
  type AgentConfig,
  type AgentMessage,
  type AgentSession,
  type AgentStream,
} from './api';

export interface AgentChat {
  /** Null until the first load answers. `enabled: false` is a deployment with no provider. */
  readonly config: AgentConfig | null;
  /** The first load of the config and the conversation list. */
  readonly loading: boolean;
  readonly sessions: readonly AgentSession[];
  readonly activeId: UUID | null;
  readonly active: AgentSession | null;
  readonly messages: readonly AgentMessage[];
  /** A run is outstanding, or a question is on its way. The composer is shut either way. */
  readonly busy: boolean;
  /** What the approved steps did, by the id of the turn that proposed them. */
  readonly applied: Readonly<Record<string, readonly string[]>>;
  /** The proposal currently being applied or declined, so its card can show it. */
  readonly deciding: UUID | null;
  /** The last refusal, in the server's own words. Cleared by the next attempt. */
  readonly failure: string | null;
  select(id: UUID): void;
  startNew(): void;
  /** Resolves to whether the question was accepted, so the composer knows what to keep. */
  send(body: string): Promise<boolean>;
  apply(messageId: UUID): Promise<void>;
  decline(messageId: UUID): Promise<void>;
  remove(id: UUID): Promise<void>;
}

export interface AgentChatOptions {
  /** Whether the panel is on screen. Nothing is fetched or polled while it is not. */
  readonly active: boolean;
  /** The streaming transport, when there is one. See `AgentStream`. */
  readonly stream?: AgentStream | undefined;
}

export function useAgentChat({ active, stream }: AgentChatOptions): AgentChat {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<readonly AgentSession[]>([]);
  const [activeId, setActiveId] = useState<UUID | null>(null);
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [applied, setApplied] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [deciding, setDeciding] = useState<UUID | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Which conversation the answers landing now belong to. A poll started before the user
  // clicked another conversation resolves after they did, and without this it would paint
  // the previous transcript over the one they are looking at.
  const showing = useRef<UUID | null>(null);
  showing.current = activeId;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const [nextConfig, nextSessions] = await Promise.all([
          fetchAgentConfig(controller.signal),
          fetchAgentSessions(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setConfig(nextConfig);
        setSessions(nextSessions);
      } catch (error) {
        if (controller.signal.aborted) return;
        setFailure(sentence(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [active]);

  const refresh = useCallback(async (id: UUID, signal?: AbortSignal): Promise<void> => {
    try {
      const thread = await fetchAgentThread(id, signal);
      if (signal?.aborted === true || showing.current !== id) return;
      setSessions(thread.sessions);
      setMessages(thread.messages);
    } catch (error) {
      if (signal?.aborted === true) return;
      setFailure(sentence(error));
    }
  }, []);

  // The transcript, whenever the chosen conversation changes.
  useEffect(() => {
    if (!active || activeId === null) return;
    const controller = new AbortController();
    void refresh(activeId, controller.signal);
    return () => controller.abort();
  }, [active, activeId, refresh]);

  const current = sessions.find((one) => one.id === activeId) ?? null;
  const running = current !== null && isRunning(current.status);

  // While a run is outstanding, ask again until it is not. `stream`, when a token stream is
  // eventually wired up, replaces the timer with the server telling us instead.
  useEffect(() => {
    if (!active || !running || activeId === null) return;
    if (stream !== undefined) return stream.subscribe(activeId, () => void refresh(activeId));
    const timer = setInterval(() => void refresh(activeId), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, running, activeId, stream, refresh]);

  const select = useCallback((id: UUID) => {
    setActiveId(id);
    setMessages([]);
    setFailure(null);
  }, []);

  const startNew = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setFailure(null);
  }, []);

  const send = useCallback(async (body: string): Promise<boolean> => {
    const text = body.trim();
    if (text === '') return false;
    setSending(true);
    setFailure(null);
    try {
      const id = showing.current;
      if (id === null) {
        const started = await createAgentSession(text);
        showing.current = started.session.id;
        setActiveId(started.session.id);
        setMessages([started.message]);
        setSessions((list) => [
          queued(started.session),
          ...list.filter((s) => s.id !== started.session.id),
        ]);
      } else {
        const message = await sendAgentMessage(id, text);
        setMessages((list) => [...list, message]);
        // Marked running here rather than waiting for the next poll: the composer has to be
        // shut on the frame the question leaves, or a fast second Enter sends a question the
        // server will refuse. The poll corrects this the moment the run really settles.
        setSessions((list) => list.map((one) => (one.id === id ? queued(one) : one)));
      }
      return true;
    } catch (error) {
      setFailure(sentence(error));
      return false;
    } finally {
      setSending(false);
    }
  }, []);

  const apply = useCallback(async (messageId: UUID): Promise<void> => {
    setDeciding(messageId);
    setFailure(null);
    try {
      const result = await applyAgentProposal(messageId);
      setMessages((list) => list.map((one) => (one.id === messageId ? result.message : one)));
      setApplied((current) => ({ ...current, [messageId]: result.applied }));
    } catch (error) {
      setFailure(sentence(error));
    } finally {
      setDeciding(null);
    }
  }, []);

  const decline = useCallback(async (messageId: UUID): Promise<void> => {
    setDeciding(messageId);
    setFailure(null);
    try {
      const message = await rejectAgentProposal(messageId);
      setMessages((list) => list.map((one) => (one.id === messageId ? message : one)));
    } catch (error) {
      setFailure(sentence(error));
    } finally {
      setDeciding(null);
    }
  }, []);

  const remove = useCallback(async (id: UUID): Promise<void> => {
    setFailure(null);
    try {
      await deleteAgentSession(id);
      setSessions((list) => list.filter((one) => one.id !== id));
      if (showing.current === id) {
        showing.current = null;
        setActiveId(null);
        setMessages([]);
      }
    } catch (error) {
      setFailure(sentence(error));
    }
  }, []);

  return {
    config,
    loading,
    sessions,
    activeId,
    active: current,
    messages,
    busy: sending || running,
    applied,
    deciding,
    failure,
    select,
    startNew,
    send,
    apply,
    decline,
    remove,
  };
}

/** The same session, said to be running. See the note at the call site in `send`. */
function queued(one: AgentSession): AgentSession {
  return { ...one, status: 'queued', error: null };
}

/**
 * What to put in front of the user.
 *
 * An `ApiError` carries the server's sentence, which is written for a person and is usually
 * the only thing that says why. Anything else is a fault in this client, and its message is
 * not something to show.
 */
function sentence(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'The agent could not be reached.';
}
