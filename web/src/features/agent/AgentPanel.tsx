/**
 * The agent's side panel: the conversation list, one transcript, and the box you type in.
 *
 * Shaped like `features/peek/Peek.tsx` — mounted unconditionally by the shell and told
 * whether it is open, so that it can animate out. A component cannot animate its own
 * removal from a tree it has already left, and `usePresence` is the extra life that lets it
 * try; while it is leaving, the node is inert and reads to nobody.
 *
 * The panel is a rail over the screen rather than a column beside it, because it opens over
 * whatever you were already doing — a list, an issue, a settings page — and none of those
 * should reflow because you asked a question about them.
 *
 * Two states, not three. With no conversation chosen you are looking at the recent ones and
 * a composer that starts a new one; with a conversation chosen you are looking at it. There
 * is no separate "new chat" screen, because an empty composer already is one.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button, EmptyState, IconButton, Spinner, Textarea } from '~/components';
import { ChevronGlyph, CrossGlyph, PlusGlyph, TrashGlyph } from '~/features/issue/glyphs';
import { when } from '~/features/time';
import { usePresence } from '~/hooks/usePresence';
import type { UUID } from '~/store';

import { isRunning, type AgentMessage, type AgentStream } from './api';
import { ProposalCard } from './ProposalCard';
import { useAgentChat, type AgentChat } from './useAgentChat';
import styles from './AgentPanel.module.css';

export interface AgentPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * The live transport, once one exists. Absent means the panel polls; see `AgentStream`.
   * A prop rather than a module import so the seam is visible from the shell.
   */
  stream?: AgentStream | undefined;
}

export function AgentPanel({ open, onClose, stream }: AgentPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const { present, exitProps } = usePresence(open, panelRef);
  const chat = useAgentChat({ active: present, stream });

  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(false);

  // Opening the panel puts the caret where the question goes. Anything else costs a Tab
  // that nothing on screen tells you to press.
  useEffect(() => {
    if (open) composerRef.current?.focus();
  }, [open]);

  // And puts it back when the answer lands. A disabled control cannot hold focus, so asking
  // a question drops the caret to the document; without this, the next one starts with a
  // click that nothing on screen asked for.
  useEffect(() => {
    if (wasBusy.current && !chat.busy) composerRef.current?.focus();
    wasBusy.current = chat.busy;
  }, [chat.busy]);

  // The newest turn, whenever one arrives. `scrollTop` rather than `scrollTo` because it is
  // a plain property that works everywhere, including jsdom.
  useEffect(() => {
    const node = logRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [chat.messages, chat.busy]);

  if (!present) return null;

  const notConfigured = chat.config !== null && !chat.config.enabled;
  const runError =
    chat.active !== null && chat.active.status === 'failed' ? chat.active.error : null;

  const submit = () => {
    const text = draft.trim();
    if (text === '' || chat.busy || notConfigured) return;
    void chat.send(text).then((accepted) => {
      // Kept on a refusal. The question is often the longest thing anybody types into this
      // product, and clearing the box on a failure throws it away with nowhere to get it back.
      if (accepted) setDraft('');
    });
  };

  const composerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    submit();
  };

  const startNew = () => {
    chat.startNew();
    setDraft('');
    composerRef.current?.focus();
  };

  return (
    <aside ref={panelRef} className={styles.panel} aria-label="Agent" {...exitProps}>
      <header className={styles.header}>
        {chat.activeId === null ? null : (
          <IconButton
            aria-label="Back to conversations"
            size="sm"
            className={styles.back}
            icon={<ChevronGlyph />}
            onClick={() => chat.startNew()}
          />
        )}
        <h2 className={styles.title}>{chat.active?.title ?? 'Agent'}</h2>
        <IconButton
          aria-label="New conversation"
          size="sm"
          icon={<PlusGlyph />}
          onClick={startNew}
        />
        <IconButton
          aria-label="Close agent"
          keys="mod+j"
          size="sm"
          icon={<CrossGlyph />}
          onClick={onClose}
        />
      </header>

      {notConfigured ? (
        <EmptyState
          className={styles.notConfigured}
          title="The agent is not set up here"
          description="No model provider is configured on this deployment, so there is nothing to ask."
        />
      ) : (
        <>
          <div ref={logRef} className={styles.log}>
            {chat.activeId === null ? (
              <SessionList chat={chat} />
            ) : (
              <div role="log" aria-label="Conversation">
                {chat.messages.map((message) => (
                  <Turn
                    key={message.id}
                    message={message}
                    applied={chat.applied[message.id]}
                    deciding={chat.deciding === message.id}
                    onApply={() => void chat.apply(message.id)}
                    onDecline={() => void chat.decline(message.id)}
                  />
                ))}
              </div>
            )}

            {chat.active !== null && isRunning(chat.active.status) ? (
              <p className={styles.working}>
                <Spinner size="sm" label="The agent is working" />
                Working…
              </p>
            ) : null}

            {runError === null ? null : (
              <p className={styles.runError} role="alert">
                {runError}
              </p>
            )}
          </div>

          {chat.failure === null ? null : (
            <p className={styles.failure} role="alert">
              {chat.failure}
            </p>
          )}

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Textarea
              ref={composerRef}
              className={styles.composerField}
              surface="plain"
              label="Ask the agent"
              hideLabel
              placeholder={chat.busy ? 'Waiting for the agent…' : 'Ask, or describe a change…'}
              minRows={2}
              maxRows={10}
              disabled={chat.busy}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={
                /* keymap-lint-allow: Enter here has to be taken before the surrounding
                   surface sees it, and the registry cannot express that. The issue list's
                   Enter-to-open is registered unguarded in the `list` context, which beats
                   anything this panel could register in `global`; and the one Enter binding
                   in the sealed `editor` context belongs to the description editor and is
                   also unguarded, so a second one there is refused outright by the conflict
                   check. This is the documented case — an interception rather than a
                   shortcut. It is not something to search a command list for, and it must
                   not appear on the shortcut sheet as a key that works outside this box. */
                composerKey
              }
            />
            <div className={styles.composerFoot}>
              <span className={styles.composerHint}>
                {chat.busy
                  ? 'One question at a time.'
                  : 'Enter to send · Shift+Enter for a new line'}
              </span>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={draft.trim() === '' || chat.busy}
              >
                Send
              </Button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
}

/** One turn: what was said, what was run to say it, and what it wants permission for. */
function Turn({
  message,
  applied,
  deciding,
  onApply,
  onDecline,
}: {
  message: AgentMessage;
  applied: readonly string[] | undefined;
  deciding: boolean;
  onApply: () => void;
  onDecline: () => void;
}) {
  const mine = message.role === 'user';

  return (
    <article className={mine ? styles.userTurn : styles.agentTurn}>
      <p className={styles.role}>{mine ? 'You' : 'Agent'}</p>

      {message.toolCalls.length === 0 ? null : (
        <ul className={styles.tools} aria-label="What the agent ran">
          {message.toolCalls.map((call, index) => (
            // Index, because a tool call has no id and its place in the turn is its identity.
            <li
              key={index}
              className={call.isError ? styles.toolFailed : styles.tool}
              title={call.name}
            >
              {call.summary}
            </li>
          ))}
        </ul>
      )}

      {message.body === '' ? null : <p className={styles.body}>{message.body}</p>}

      {message.proposal === null || message.proposalState === null ? null : (
        <ProposalCard
          proposal={message.proposal}
          state={message.proposalState}
          applied={applied}
          busy={deciding}
          onApply={onApply}
          onDecline={onDecline}
        />
      )}
    </article>
  );
}

/**
 * The recent conversations, and the way to be rid of one.
 *
 * Delete is two presses in the row rather than a dialog. `ConfirmDialog` exists for changes
 * whose consequences need a sentence to explain — a member losing access, a key being
 * revoked — and "this chat goes away" is not one of them. What matters is that the first
 * press cannot be the last, which a revealed second button gives without taking the screen.
 */
function SessionList({ chat }: { chat: AgentChat }) {
  const [confirming, setConfirming] = useState<UUID | null>(null);

  if (chat.loading && chat.sessions.length === 0) {
    return (
      <p className={styles.working}>
        <Spinner size="sm" label="Loading conversations" />
        Loading…
      </p>
    );
  }

  if (chat.sessions.length === 0) {
    return (
      <EmptyState
        title="Nothing asked yet"
        description="Describe a change, or ask about the work in this workspace. Nothing is written until you approve it."
      />
    );
  }

  return (
    <nav aria-label="Recent conversations">
      <ul className={styles.sessions}>
        {chat.sessions.map((session) => (
          <li key={session.id} className={styles.session}>
            <button
              type="button"
              className={styles.sessionOpen}
              onClick={() => chat.select(session.id)}
            >
              <span className={styles.sessionTitle}>{session.title}</span>
              <span className={styles.sessionWhen}>{when(session.updatedAt)}</span>
            </button>
            {confirming === session.id ? (
              <Button
                variant="danger"
                size="xs"
                onClick={() => {
                  setConfirming(null);
                  void chat.remove(session.id);
                }}
              >
                Delete
              </Button>
            ) : (
              <IconButton
                aria-label={`Delete ${session.title}`}
                variant="danger"
                size="sm"
                icon={<TrashGlyph />}
                onClick={() => setConfirming(session.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
