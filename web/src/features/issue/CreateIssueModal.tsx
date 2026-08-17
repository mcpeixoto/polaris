/**
 * The create-issue modal, reached with `C` from anywhere.
 *
 * It is the fastest path in the product and the one the whole optimistic architecture is
 * justified by: type a title, press ⌘⏎, and the issue is in the list on the next frame
 * whether or not the server has heard about it yet. Everything about the screen is arranged
 * around that — focus lands in the title field, every other field is reachable with Tab and
 * operable with the arrow keys, and nothing waits on the network before closing.
 *
 * The properties are native `<Select>`s rather than the Menu-based pickers the list and the
 * detail view use, and that is a deliberate split rather than an inconsistency. In those
 * places changing a status is a *command* — it has a shortcut, it acts on a selection, it
 * wants a filter. Here it is a form field being filled in on the way to a submit, where the
 * platform's own control is better at everything that matters: it tabs, it types ahead, it
 * opens as a wheel on a phone, and it needs no focus trap of its own inside a dialog that
 * already has one.
 */

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Button,
  Input,
  Modal,
  priorityLabel,
  PRIORITY_LEVELS,
  Select,
  STATE_LABELS,
  Textarea,
} from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import { CATEGORY_ORDER, type StateCategory, type UUID, type WorkflowState } from '~/store';
import { ApiError } from '~/sync/api';
import { createIssue } from './mutations';
import styles from './CreateIssueModal.module.css';

export interface CreateIssueModalProps {
  onClose: () => void;
}

interface StateOption {
  readonly id: UUID;
  readonly name: string;
  readonly category: StateCategory;
  readonly position: string;
  readonly isDefault: boolean;
}

/** The empty value of the assignee select. An `<option>` cannot carry null. */
const UNASSIGNED = '';

export function CreateIssueModal({ onClose }: CreateIssueModalProps) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const formId = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .map((team) => ({ id: team.id, key: team.key, name: team.name }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );

  const people = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter((user) => user.status === 'active' && user.archivedAt === undefined)
        .map((user) => ({ id: user.id, name: user.displayName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['user'],
  );

  const [chosenTeam, setChosenTeam] = useState<UUID | null>(null);
  const [chosenState, setChosenState] = useState<UUID | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState<UUID>(UNASSIGNED);
  const [priority, setPriority] = useState(0);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The team the user is looking at, read from the path rather than passed in. This modal is
  // mounted by the shell, above the route that knows which team is on screen, so `useParams`
  // here would answer for a route that has not matched.
  const fromPath = useTeamKeyInPath();

  /**
   * The team the issue will belong to.
   *
   * Derived rather than stored, so that a replica which finishes hydrating after the dialog
   * opened still lands on a real team instead of leaving the field on a value that was empty
   * when the first render happened.
   */
  const teamId = useMemo(() => {
    if (chosenTeam !== null && teams.some((team) => team.id === chosenTeam)) return chosenTeam;
    return teams.find((team) => team.key === fromPath)?.id ?? teams[0]?.id ?? '';
  }, [chosenTeam, teams, fromPath]);

  const states = useLiveQuery(
    (store) =>
      teamId === ''
        ? []
        : [...store.workflowStateIdsFor(teamId)]
            .map((id) => store.get('workflowState', id))
            .filter(
              (state): state is WorkflowState =>
                state !== undefined && state.archivedAt === undefined && !state.isSystem,
            )
            .map((state) => ({
              id: state.id,
              name: state.name,
              category: state.category,
              position: state.position,
              isDefault: state.isDefault,
            }))
            .sort(byCategoryThenPosition),
    ['workflowState'],
    [teamId],
  );

  // Held as a choice rather than a value for the same reason as the team: switching team has
  // to move the field to the new team's default, not leave a status id the new team does not
  // own.
  const stateId = useMemo(() => {
    if (chosenState !== null && states.some((state) => state.id === chosenState)) {
      return chosenState;
    }
    return (states.find((state) => state.isDefault) ?? states[0])?.id ?? '';
  }, [chosenState, states]);

  const save = async () => {
    if (saving) return;
    const trimmed = title.trim();
    if (trimmed === '') {
      setTitleError('An issue needs a title.');
      titleRef.current?.focus();
      return;
    }
    if (teamId === '') {
      setSaveError('This workspace has no team to put an issue in.');
      return;
    }

    setSaving(true);
    setTitleError(null);
    setSaveError(null);
    try {
      await createIssue(engine, {
        teamId,
        title: trimmed,
        description: description.trim(),
        stateId: stateId === '' ? undefined : stateId,
        assigneeId: assigneeId === UNASSIGNED ? undefined : assigneeId,
        priority,
        creatorId: viewerId ?? undefined,
      });
      // Closed without waiting for anything else: the issue is already in the list, and the
      // outbox owns the rest of the story.
      onClose();
    } catch (failure) {
      setSaving(false);
      setSaveError(
        failure instanceof ApiError ? failure.message : 'The issue could not be created.',
      );
    }
  };

  // Read through a ref by the registered action below. An action's `run` closure is captured
  // once at registration, so an action calling `save` directly would go on submitting the
  // form as it stood when the dialog opened.
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = () => void save();

  // Everything the dialog covers belongs to the dialog: `J` must not scroll the list behind
  // it, and `C` must not open a second one.
  useKeyContext('modal');

  useActions(
    [
      {
        id: 'issue.submitNew',
        title: 'Save new issue',
        keys: ['mod+Enter'],
        when: 'modal',
        group: 'Issues',
        // Hidden from the command menu: it means nothing unless this dialog is open, and the
        // dialog already offers the same command as a button.
        hidden: true,
        run: () => submitRef.current(),
      },
    ],
    [],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New issue"
      size="lg"
      initialFocus={titleRef}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Create issue
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={onSubmit}>
        <Input
          ref={titleRef}
          label="Title"
          value={title}
          error={titleError ?? undefined}
          placeholder="Something that needs doing"
          autoComplete="off"
          onChange={(event) => {
            setTitle(event.target.value);
            if (titleError !== null) setTitleError(null);
          }}
        />

        <Textarea
          label="Description"
          value={description}
          minRows={3}
          maxRows={12}
          hint="Markdown. The rich editor arrives in M2."
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className={styles.properties}>
          <Select
            label="Team"
            value={teamId}
            onChange={(event) => {
              setChosenTeam(event.target.value);
              setChosenState(null);
            }}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.key} · {team.name}
              </option>
            ))}
          </Select>

          <Select
            label="Status"
            value={stateId}
            onChange={(event) => setChosenState(event.target.value)}
          >
            {groupByCategory(states).map(([category, group]) => (
              <optgroup key={category} label={STATE_LABELS[category]}>
                {group.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>

          <Select
            label="Assignee"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value={UNASSIGNED}>No assignee</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>

          <Select
            label="Priority"
            value={String(priority)}
            onChange={(event) => setPriority(Number(event.target.value))}
          >
            {PRIORITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {priorityLabel(level)}
              </option>
            ))}
          </Select>
        </div>

        {saveError === null ? null : (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        )}
      </form>
    </Modal>
  );
}

function useTeamKeyInPath(): string | null {
  const { pathname } = useLocation();
  return useMemo(() => /^\/team\/([^/]+)/.exec(pathname)?.[1] ?? null, [pathname]);
}

/**
 * Categories in the product's order, then the team's own order inside each. Positions are
 * fractional indices and are only comparable within a category.
 */
function byCategoryThenPosition(a: StateOption, b: StateOption): number {
  const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (byCategory !== 0) return byCategory;
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/** Statuses bucketed under their category, in the order `byCategoryThenPosition` left them. */
function groupByCategory(states: readonly StateOption[]): [StateCategory, StateOption[]][] {
  const groups: [StateCategory, StateOption[]][] = [];
  for (const state of states) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0] === state.category) last[1].push(state);
    else groups.push([state.category, [state]]);
  }
  return groups;
}
