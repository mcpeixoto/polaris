/**
 * The create-initiative dialog, reached with `I` from anywhere.
 *
 * It used to ask for a name and a parent, and nothing else: an initiative's owner, status,
 * priority, target date, lead team and labels were all unreachable until after it existed,
 * even though `CreateInitiativeInput` has always accepted every one of them. That is the
 * mistake this file prevents — a dialog that files a half-described objective and then makes
 * somebody open the detail page to finish the sentence they were already in the middle of.
 *
 * So it is the create-issue composer's shape, for the create-issue composer's reasons. The
 * name is the document and not a form value, which is why it has no visible label: it is
 * the title of the thing being written, sized like one, with the description under it. The
 * properties are a wrapping row of pills, each named by its value and described by its
 * property, each opening the same `Menu` the list and the detail page use, each answering to
 * the chord its filter box teaches. A native `<select>` over every initiative in the
 * workspace — which is what the parent field was — cannot be filtered, and in a workspace
 * with sixty objectives that is not a picker, it is a scroll bar.
 *
 * "Create more" is a switch rather than a second button, because it changes what the primary
 * button does rather than being a different thing to do: with it on, ⌘⏎ files and stays, and
 * keeps every property for the next one while clearing the words. ⌘⇧⏎ does that whatever the
 * switch says.
 *
 * Two things are worth knowing before changing it.
 *
 * **Labels are applied after the id resolves.** They are link rows and not columns, so they
 * cannot ride along on the input. A label that fails to attach is therefore reported and not
 * thrown: the initiative exists by then, and losing it to tidy up a label would be a far
 * worse outcome than an objective with one label missing.
 *
 * **There is no icon pill.** An initiative has no icon or colour — not in the schema, not in
 * the replica — so the picker would set a value nothing could ever read. It belongs with the
 * backend change that adds the column.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  ConfirmDialog,
  DatePicker,
  IconButton,
  Input,
  LabelChip,
  Menu,
  Modal,
  priorityLabel,
  PriorityIcon,
  PropertyPill,
  StateIcon,
  Switch,
  Textarea,
  type MenuNode,
} from '~/components';
import { PriorityPicker } from '~/features/issue/pickers';
import { InitiativeLabelPicker } from '~/features/initiative-labels/InitiativeLabelPicker';
import { addInitiativeLabel } from '~/features/initiative-labels/mutations';
import { UserPicker } from '~/features/members/UserPicker';
import { browserTimezone } from '~/features/locale';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useDiscardGuard } from '~/hooks/useDiscardGuard';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import type { InitiativeStatus, UUID } from '~/store';

import { InitiativeGlyph } from './glyphs';
import { InitiativePicker } from './InitiativePicker';
import { createInitiative, formatInitiativeStatus, INITIATIVE_STATUS_ICON } from './mutations';
import styles from './CreateInitiativeModal.module.css';

/** The five statuses, in the order an objective moves through them. */
const STATUSES: readonly InitiativeStatus[] = [
  'proposed',
  'planned',
  'active',
  'completed',
  'canceled',
];

const DEFAULT_STATUS: InitiativeStatus = 'planned';

export interface CreateInitiativeModalProps {
  /**
   * Whether the dialog is up.
   *
   * The shell mounts this component for its own lifetime and tells it, rather than
   * rendering it into existence: a dialog cannot animate its own removal from a tree it has
   * already left, and one that exists only while it is open pushes the `modal` key context
   * and claims ⌘⏎ as a side effect of mounting. Both are gated on this, so a closed dialog
   * claims nothing.
   *
   * Defaults to true, which is the contract this component had before the prop existed:
   * something that mounted it meant it.
   */
  open?: boolean | undefined;
  onClose: () => void;
}

export function CreateInitiativeModal({ open = true, onClose }: CreateInitiativeModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<InitiativeStatus>(DEFAULT_STATUS);
  const [priority, setPriority] = useState(0);
  /**
   * `undefined` means nobody has answered, and the answer is then the viewer — which is who
   * an objective belongs to until somebody says otherwise. `null` is a chosen "no owner", and
   * the two are different: one is a default the dialog is free to change under you, the other
   * is a decision.
   */
  const [owner, setOwner] = useState<UUID | null | undefined>(undefined);
  const [leadTeamId, setLeadTeamId] = useState<UUID | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [parentId, setParentId] = useState<UUID | null>(null);
  const [labelIds, setLabelIds] = useState<readonly UUID[]>([]);
  const [createMore, setCreateMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [filed, setFiled] = useState(0);
  const [labelNote, setLabelNote] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const {
    saving,
    error: saveError,
    submit,
    reset,
    submitRef,
  } = useDialogSubmit('The initiative could not be created.');

  const ownerId = owner === undefined ? (viewerId ?? null) : owner;

  const ownerName = useLiveQuery(
    (store) => (ownerId === null ? null : (store.users.get(ownerId)?.displayName ?? null)),
    ['user'],
    [ownerId ?? ''],
  );
  const ownerAvatar = useLiveQuery(
    (store) => (ownerId === null ? null : (store.users.get(ownerId)?.avatarUrl ?? null)),
    ['user'],
    [ownerId ?? ''],
  );

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .map((team) => ({ id: team.id, key: team.key, name: team.name, timezone: team.timezone }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['team'],
  );
  const leadTeam = teams.find((team) => team.id === leadTeamId) ?? null;

  const parentName = useLiveQuery(
    (store) => (parentId === null ? null : (store.initiatives.get(parentId)?.name ?? null)),
    ['initiative'],
    [parentId ?? ''],
  );

  const chosenLabels = useLiveQuery(
    (store) =>
      labelIds
        .map((id) => store.initiativeLabels.get(id))
        .filter((label) => label !== undefined)
        .map((label) => ({ id: label.id, name: label.name, color: label.color })),
    ['initiativeLabel'],
    [labelIds.join(',')],
  );

  const ownerMenu = useMenuTrigger();
  const statusMenu = useMenuTrigger();
  const priorityMenu = useMenuTrigger();
  const targetMenu = useMenuTrigger('dialog');
  const parentMenu = useMenuTrigger();
  const teamMenu = useMenuTrigger();
  const labelMenu = useMenuTrigger();

  // What counts as work worth asking about. A defaulted owner does not: nobody typed it.
  const dirty =
    name.trim() !== '' ||
    description.trim() !== '' ||
    status !== DEFAULT_STATUS ||
    priority !== 0 ||
    owner !== undefined ||
    leadTeamId !== null ||
    targetDate !== null ||
    parentId !== null ||
    labelIds.length > 0;

  const { requestClose, confirming, keep, discard } = useDiscardGuard(dirty, onClose);

  const save = async ({ another = createMore }: { another?: boolean } = {}) => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('An initiative needs a name');
      nameRef.current?.focus();
      return;
    }
    setLabelNote(null);
    await submit(async () => {
      const id = await createInitiative(engine, {
        name: trimmed,
        description: description.trim() === '' ? undefined : description,
        status,
        priority,
        ownerId: ownerId ?? undefined,
        leadTeamId: leadTeamId ?? undefined,
        targetDate: targetDate ?? undefined,
        parentInitiativeId: parentId ?? undefined,
      });

      // The initiative exists from here on. A label that will not attach is a smaller loss
      // than the initiative, so it is reported rather than thrown — throwing would put the
      // dialog back up holding a copy of something that has already been filed.
      const missed: string[] = [];
      for (const label of chosenLabels) {
        try {
          await addInitiativeLabel(engine, id, label.id);
        } catch {
          missed.push(label.name);
        }
      }

      if (another) {
        // The properties stay and the words go: the next objective in a sitting shares the
        // owner, the timeframe and the parent, and shares none of its prose.
        reset();
        setName('');
        setDescription('');
        setFiled((count) => count + 1);
        setLabelNote(
          missed.length === 0 ? null : `Could not apply ${missed.join(', ')} to the last one.`,
        );
        nameRef.current?.focus();
        return;
      }

      onClose();
      if (id !== '') void navigate(`/initiative/${id}`);
    });
  };

  // Read at dispatch rather than closed over at registration: the two submit paths differ
  // only by an argument, and `useDialogSubmit` hands out the ref so every dialog binds ⌘⏎
  // the same way.
  submitRef.current = () => void save();
  const submitAnotherRef = useRef<() => void>(() => {});
  submitAnotherRef.current = () => void save({ another: true });

  useKeyContext('modal', open);

  /**
   * The property chords. They only fire with focus outside a text field — the keymap hands a
   * bare letter to whichever field holds the caret — so they are what Tab-then-`S` does, and
   * what each picker's filter row teaches. Guarded on `confirming`: a picker opened behind
   * the discard question would float over it.
   */
  const openPicker = (show: () => void) => {
    if (!confirming) show();
  };

  // Registered only while the dialog is up: a shut dialog that still bound ⌘⏎ would collide
  // with the next one to claim it.
  useActions(
    open
      ? [
          {
            id: 'initiative.create.submit',
            title: 'Create initiative',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => submitRef.current(),
          },
          {
            id: 'initiative.create.submitAndAnother',
            title: 'Create initiative and start another',
            keys: ['mod+shift+Enter'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => submitAnotherRef.current(),
          },
          {
            id: 'initiative.create.owner',
            title: 'Set owner',
            keys: ['a'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => openPicker(ownerMenu.show),
          },
          {
            id: 'initiative.create.status',
            title: 'Change status',
            keys: ['s'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => openPicker(statusMenu.show),
          },
          {
            id: 'initiative.create.priority',
            title: 'Set priority',
            keys: ['p'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => openPicker(priorityMenu.show),
          },
          {
            id: 'initiative.create.targetDate',
            title: 'Set target date',
            keys: ['shift+d'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => openPicker(targetMenu.show),
          },
          {
            id: 'initiative.create.parent',
            title: 'Set parent initiative',
            keys: ['shift+i'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => openPicker(parentMenu.show),
          },
          {
            id: 'initiative.create.leadTeam',
            title: 'Set lead team',
            keys: ['t'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => openPicker(teamMenu.show),
          },
          {
            id: 'initiative.create.labels',
            title: 'Add labels',
            keys: ['l'],
            when: 'modal',
            group: 'Initiatives',
            hidden: true,
            run: () => openPicker(labelMenu.show),
          },
        ]
      : [],
    [open, confirming],
  );

  const statusItems: MenuNode[] = STATUSES.map((option) => ({
    id: option,
    label: formatInitiativeStatus(option),
    icon: <StateIcon category={INITIATIVE_STATUS_ICON[option]} decorative />,
    selected: option === status,
    onSelect: () => setStatus(option),
  }));

  const teamItems: MenuNode[] = [
    {
      id: 'none',
      label: 'No lead team',
      selected: leadTeamId === null,
      onSelect: () => setLeadTeamId(null),
    },
    { kind: 'separator' },
    ...teams.map((team) => ({
      id: team.id,
      label: team.name,
      text: `${team.key} ${team.name}`,
      hint: team.key,
      selected: team.id === leadTeamId,
      onSelect: () => setLeadTeamId(team.id),
    })),
  ];

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title="New initiative"
        size="composer"
        // The expand button: the same dialog, given the window. A class rather than a fifth
        // `ModalSize`, because "as big as the screen" is this dialog's answer to a long
        // description and not a width other dialogs should be able to ask for.
        className={expanded ? styles.fullScreen : undefined}
        initialFocus={nameRef}
        header={
          <div className={styles.header}>
            <span className={styles.crumbGlyph} aria-hidden="true">
              <InitiativeGlyph />
            </span>
            <span className={styles.crumbLabel} aria-hidden="true">
              Initiatives
            </span>
            <span className={styles.crumb} aria-hidden="true">
              <ChevronGlyph />
            </span>
            <span className={styles.heading} aria-hidden="true">
              New initiative
            </span>
            <div className={styles.headerActions}>
              <IconButton
                aria-label={expanded ? 'Collapse' : 'Expand'}
                icon={<ExpandGlyph />}
                onClick={() => setExpanded((current) => !current)}
              />
              <IconButton
                aria-label="Close"
                keys="Escape"
                icon={<CloseGlyph />}
                onClick={requestClose}
              />
            </div>
          </div>
        }
        footer={
          <div className={styles.footer}>
            <Switch label="Create more" checked={createMore} onChange={setCreateMore} />
            <Button form={formId} type="submit" variant="primary" loading={saving}>
              Create initiative
            </Button>
          </div>
        }
      >
        <form
          id={formId}
          className={styles.form}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            ref={nameRef}
            label="Name"
            hideLabel
            className={styles.title}
            surface="bare"
            value={name}
            error={nameError ?? undefined}
            placeholder="Initiative name"
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (nameError !== null) setNameError(null);
            }}
          />

          <Textarea
            label="Description"
            hideLabel
            className={styles.description}
            surface="bare"
            value={description}
            minRows={3}
            maxRows={12}
            placeholder="Add description…"
            onChange={(event) => setDescription(event.target.value)}
          />

          {/*
            The properties. Each pill is named by its value and described by its property —
            "Planned, button, Status" — because a row of values has to be scannable by eye and
            still say what each one is to somebody who cannot see the glyph.
          */}
          <div className={styles.properties}>
            <PropertyPill
              {...statusMenu.props}
              name="Status"
              describe={`${formId}-status`}
              icon={<StateIcon category={INITIATIVE_STATUS_ICON[status]} decorative />}
            >
              {formatInitiativeStatus(status)}
            </PropertyPill>

            <PropertyPill
              {...priorityMenu.props}
              name="Priority"
              describe={`${formId}-priority`}
              empty={priority === 0 ? priorityLabel(0) : undefined}
              icon={<PriorityIcon priority={priority} decorative />}
            >
              {priority === 0 ? 'Priority' : priorityLabel(priority)}
            </PropertyPill>

            <PropertyPill
              {...ownerMenu.props}
              name="Owner"
              describe={`${formId}-owner`}
              empty={ownerName === null ? 'No owner' : undefined}
              icon={
                ownerName === null || ownerId === null ? (
                  <PersonGlyph />
                ) : (
                  <Avatar
                    name={ownerName}
                    src={ownerAvatar}
                    size="xs"
                    colorKey={ownerId}
                    decorative
                  />
                )
              }
            >
              {ownerName ?? 'Owner'}
            </PropertyPill>

            <PropertyPill
              {...targetMenu.props}
              name="Target date"
              describe={`${formId}-target`}
              empty={targetDate === null ? 'No target date' : undefined}
              icon={<CalendarGlyph />}
            >
              {targetDate ?? 'Target date'}
            </PropertyPill>

            <PropertyPill
              {...parentMenu.props}
              name="Parent"
              describe={`${formId}-parent`}
              empty={parentName === null ? 'No parent' : undefined}
              icon={<InitiativeGlyph />}
            >
              {parentName ?? 'Parent'}
            </PropertyPill>

            <PropertyPill
              {...teamMenu.props}
              name="Lead team"
              describe={`${formId}-lead-team`}
              empty={leadTeam === null ? 'No lead team' : undefined}
              icon={<TeamGlyph />}
            >
              {leadTeam?.name ?? 'Lead team'}
            </PropertyPill>

            <PropertyPill
              {...labelMenu.props}
              name="Labels"
              describe={`${formId}-labels`}
              empty={chosenLabels.length === 0 ? 'No labels' : undefined}
              icon={<TagGlyph />}
            >
              {chosenLabels.length === 0
                ? 'Labels'
                : chosenLabels.map((label) => (
                    <LabelChip key={label.id} compact name={label.name} color={label.color} />
                  ))}
            </PropertyPill>
          </div>

          {saveError === null ? null : (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
          {labelNote === null ? null : (
            <p className={styles.error} role="alert">
              {labelNote}
            </p>
          )}
          {/*
            "Create more" leaves the dialog covering the list, so the only evidence that the
            last one went anywhere is this line. Announced, because the person who just
            pressed the chord is looking at a name field that emptied itself.
          */}
          {filed === 0 ? null : (
            <p className={styles.dropped} role="status">
              {filed === 1
                ? 'Created 1 initiative. Keep going.'
                : `Created ${filed} initiatives. Keep going.`}
            </p>
          )}
        </form>

        <UserPicker
          open={ownerMenu.open}
          onClose={ownerMenu.hide}
          trigger={ownerMenu.ref}
          label="Owner"
          noneLabel="No owner"
          filterPlaceholder="Set owner…"
          filterHint="a"
          value={ownerId}
          onSelect={(userId) => {
            setOwner(userId);
            ownerMenu.hide();
          }}
        />
        <Menu
          open={statusMenu.open}
          onClose={statusMenu.hide}
          trigger={statusMenu.ref}
          items={statusItems}
          label="Status"
          filterable
          filterPlaceholder="Change status…"
          filterHint="s"
          emptyLabel="No status matches"
        />
        <PriorityPicker
          open={priorityMenu.open}
          onClose={priorityMenu.hide}
          trigger={priorityMenu.ref}
          value={priority}
          onSelect={(level) => {
            setPriority(level);
            priorityMenu.hide();
          }}
        />
        <DatePicker
          open={targetMenu.open}
          onClose={targetMenu.hide}
          trigger={targetMenu.ref}
          value={targetDate}
          // The lead team's zone where there is one: whether a target has slipped is a fact
          // about the team that owns the work, not about the reader's afternoon.
          timezone={leadTeam?.timezone ?? browserTimezone()}
          onSelect={(day) => {
            setTargetDate(day);
            targetMenu.hide();
          }}
          actionId="initiative.closeTargetDate"
          actionGroup="Initiatives"
          label="Target date"
          clearLabel="No target date"
        />
        <InitiativePicker
          open={parentMenu.open}
          onClose={parentMenu.hide}
          trigger={parentMenu.ref}
          label="Parent"
          noneLabel="No parent"
          filterPlaceholder="Nest under…"
          filterHint="shift+i"
          value={parentId}
          onSelect={(id) => {
            setParentId(id);
            parentMenu.hide();
          }}
        />
        <Menu
          open={teamMenu.open}
          onClose={teamMenu.hide}
          trigger={teamMenu.ref}
          items={teamItems}
          label="Lead team"
          filterable
          filterPlaceholder="Set lead team…"
          filterHint="t"
          emptyLabel="No team matches"
        />
        <InitiativeLabelPicker
          open={labelMenu.open}
          onClose={labelMenu.hide}
          trigger={labelMenu.ref}
          value={labelIds}
          onApply={(labelId, displaced) =>
            setLabelIds((current) => [
              ...current.filter((id) => !displaced.includes(id)),
              ...(current.includes(labelId) ? [] : [labelId]),
            ])
          }
          onRemove={(labelId) => setLabelIds((current) => current.filter((id) => id !== labelId))}
        />
      </Modal>

      <ConfirmDialog
        open={confirming}
        title="Discard this initiative?"
        consequence="The name, description and properties you have set will be lost. Nothing has been created yet."
        confirmLabel="Discard"
        destructive
        onConfirm={discard}
        onClose={keep}
      />
    </>
  );
}

const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
} as const;

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="m6 4 4 4-4 4" {...STROKE} />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" {...STROKE} />
    </svg>
  );
}

function ExpandGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 2.5h4v4m-11 3v4h4m7-11-4.5 4.5m-6.5 6.5 4.5-4.5" {...STROKE} />
    </svg>
  );
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.5" {...STROKE} />
      <path d="M3.5 13c.7-2.2 2.4-3.3 4.5-3.3s3.8 1.1 4.5 3.3" {...STROKE} />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" {...STROKE} />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" {...STROKE} />
    </svg>
  );
}

function TeamGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="6" cy="6" r="2.25" {...STROKE} />
      <path d="M2 12.5c.6-1.9 2-2.9 4-2.9s3.4 1 4 2.9" {...STROKE} />
      <path d="M10.5 4.2a2.25 2.25 0 0 1 0 3.6M11.5 9.9c1.4.3 2.3 1.2 2.7 2.6" {...STROKE} />
    </svg>
  );
}

function TagGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M7.3 2.5H3a.5.5 0 0 0-.5.5v4.3c0 .13.05.26.15.35l6 6a.5.5 0 0 0 .7 0l4.3-4.3a.5.5 0 0 0 0-.7l-6-6a.5.5 0 0 0-.35-.15Z"
        {...STROKE}
      />
      <circle cx="5.5" cy="5.5" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}
