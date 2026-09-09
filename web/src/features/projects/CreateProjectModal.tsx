/**
 * The create-project composer, reached from the projects list and from the command menu.
 *
 * Nothing here is required but the name. That is the whole argument for the shape: a
 * project is usually filed by somebody who already knows four or five things about it — who
 * leads it, which teams are on it, roughly when it lands, which initiative it serves — and
 * the old dialog made them file first and go and set every one of those on the project page
 * afterwards, one round trip each. The pill row is where you say what you already know. It
 * is not a form to fill in; every pill is a value you can leave alone, and the primary
 * button files with nothing but the name in it.
 *
 * This file used to argue the opposite — that a compact dialog was the discipline and a row
 * of properties was "the form-builder look this product is not allowed to ship". The
 * observation behind it was right and the conclusion was wrong: what makes a creation dialog
 * a form is a column of labelled boxes that must be filled top to bottom, and that is
 * exactly what a row of optional pills is not. The issue composer settled this for issues;
 * this is the same shape for projects, so the two most-used create paths in the product are
 * one thing to learn.
 *
 * It reads as a breadcrumb, a document and a row of properties. The header says which team
 * the project is going into and the title and description under it are unboxed, because
 * they are the project and not a form about one. Every pill is named by its value and
 * described by its property, and each opens the same picker the project page uses — the
 * status menu, the user picker, the date panel — with a filter box that teaches the chord
 * that would have opened it (`S`, `P`, `A`, `M`, `T`…).
 *
 * "Create more" is a switch rather than a second button, because it changes what the primary
 * button does rather than being a different thing to do: with it on, `Create project` and ⌘⏎
 * file and stay, keeping every property for the next one. ⌘⇧⏎ does that whatever the switch
 * says.
 */

import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

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
import { EntityIcon } from '~/features/icon/EntityIcon';
import { IconPicker } from '~/features/icon/IconPicker';
import { InitiativePicker } from '~/features/initiatives/InitiativePicker';
import { PriorityPicker } from '~/features/issue/pickers';
import { UserPicker } from '~/features/members/UserPicker';
import { ProjectLabelPicker } from '~/features/project-labels/ProjectLabelPicker';
import { projectTemplatesForTeam } from '~/features/project-templates/mutations';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useDiscardGuard } from '~/hooks/useDiscardGuard';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';

import { ProjectStatusPicker } from './ProjectStatusPicker';
import { createProject } from './mutations';
import styles from './CreateProjectModal.module.css';

export interface CreateProjectModalProps {
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

export function CreateProjectModal({ open = true, onClose }: CreateProjectModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .map((team) => ({
          id: team.id,
          key: team.key,
          name: team.name,
          icon: team.icon,
          timezone: team.timezone,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );

  const fromPath = useTeamKeyInPath();
  const [chosenTeams, setChosenTeams] = useState<readonly UUID[] | null>(null);
  const [templateId, setTemplateId] = useState<UUID | null>(null);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState<UUID | null>(null);
  const [priority, setPriority] = useState(0);
  const [leadId, setLeadId] = useState<UUID | null>(null);
  const [memberIds, setMemberIds] = useState<ReadonlySet<UUID>>(() => new Set());
  const [startDate, setStartDate] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [initiativeId, setInitiativeId] = useState<UUID | null>(null);
  const [labelIds, setLabelIds] = useState<readonly UUID[]>([]);
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  /** "Create more": file and stay, for a run of projects against the same properties. */
  const [createMore, setCreateMore] = useState(false);
  /** The expand button: the same composer, given the window. */
  const [expanded, setExpanded] = useState(false);

  const {
    saving,
    error: saveError,
    setError: setSaveError,
    submit,
    submitRef,
    reset,
  } = useDialogSubmit('Could not create the project');

  /**
   * The teams the project will belong to.
   *
   * Derived until somebody picks, so a replica that finishes hydrating after the dialog
   * opened still lands on a real team instead of on a value that was empty at first render.
   * A project may span teams — that is what `teamIds[]` is for — but the header names one,
   * and the first is the one the breadcrumb and the template offering read.
   */
  const teamIds = useMemo(() => {
    if (chosenTeams !== null) {
      const live = chosenTeams.filter((id) => teams.some((team) => team.id === id));
      if (live.length > 0) return live;
    }
    const fromKey = teams.find((team) => team.key === fromPath)?.id;
    if (fromKey !== undefined) return [fromKey];
    const first = teams[0]?.id;
    return first === undefined ? [] : [first];
  }, [chosenTeams, teams, fromPath]);

  const primaryTeamId = teamIds[0] ?? '';
  const team = teams.find((candidate) => candidate.id === primaryTeamId);
  const timezone = team?.timezone ?? 'UTC';

  const templates = useLiveQuery(
    (store) => (primaryTeamId === '' ? [] : projectTemplatesForTeam(store, primaryTeamId)),
    ['projectTemplate', 'team'],
    [primaryTeamId],
  );

  const statuses = useLiveQuery(
    (store) =>
      [...store.projectStatuses.values()]
        .filter((status) => status.archivedAt === undefined)
        .map((status) => ({
          id: status.id,
          name: status.name,
          color: status.color,
          category: status.category,
          isDefault: status.isDefault,
        })),
    ['projectStatus'],
  );

  // The status the project will be filed on: the one that was picked, or the workspace
  // default. Resolved rather than stored so that a default arriving with the replica after
  // the dialog opened is still the one the pill shows.
  const selectedStatus =
    statuses.find((status) => status.id === statusId) ??
    statuses.find((status) => status.isDefault) ??
    statuses[0];

  const lead = useLiveQuery(
    (store) => {
      if (leadId === null) return null;
      const user = store.users.get(leadId);
      return user === undefined
        ? null
        : { id: user.id, name: user.displayName, avatarUrl: user.avatarUrl ?? null };
    },
    ['user'],
    [leadId ?? ''],
  );

  const initiativeName = useLiveQuery(
    (store) => (initiativeId === null ? null : (store.initiatives.get(initiativeId)?.name ?? null)),
    ['initiative'],
    [initiativeId ?? ''],
  );

  /**
   * The chosen labels, resolved for the pill's chips.
   *
   * Nothing is filed yet, so there is no project to read them off; this turns the ids back
   * into the names and colours the chip draws. A label deleted from another tab drops out of
   * the row rather than rendering as a blank chip.
   */
  const chosenLabels = useLiveQuery(
    (store) =>
      labelIds.flatMap((id) => {
        const label = store.projectLabels.get(id);
        if (label === undefined || label.archivedAt !== undefined) return [];
        return [{ id: label.id, name: label.name, color: label.color }];
      }),
    ['projectLabel'],
    [labelIds.join(',')],
  );

  const templateName = templates.find((candidate) => candidate.id === templateId)?.name ?? null;

  const teamMenu = useMenuTrigger();
  const statusMenu = useMenuTrigger();
  const priorityMenu = useMenuTrigger();
  const leadMenu = useMenuTrigger();
  const memberMenu = useMenuTrigger();
  const initiativeMenu = useMenuTrigger();
  const labelMenu = useMenuTrigger();
  const templateMenu = useMenuTrigger();
  const startMenu = useMenuTrigger('dialog');
  const targetMenu = useMenuTrigger('dialog');
  const iconMenu = useMenuTrigger('dialog');

  /**
   * Whether there is typing in here nobody else has a copy of.
   *
   * The words only — a team the path pre-filled is not work somebody did, and asking "are
   * you sure" over a dialog that was opened and immediately dismissed teaches people to
   * dismiss the question without reading it.
   */
  const dirty = name.trim() !== '' || summary.trim() !== '' || description.trim() !== '';
  const { requestClose, confirming, keep, discard } = useDiscardGuard(dirty, onClose);

  const applyTemplate = (id: UUID | null) => {
    setTemplateId(id);
    if (id === null) return;
    const template = templates.find((candidate) => candidate.id === id);
    if (template === undefined) return;
    setName(template.name);
    setSummary(template.summary);
  };

  const save = async ({ another = false }: { another?: boolean } = {}) => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A project needs a name');
      nameRef.current?.focus();
      return;
    }
    if (teamIds.length === 0) {
      setSaveError('A project needs a team');
      return;
    }

    await submit(async () => {
      const id = await createProject(engine, {
        name: trimmed,
        summary: summary.trim() === '' ? undefined : summary.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        teamIds,
        statusId: selectedStatus?.id,
        priority,
        leadId: leadId ?? undefined,
        creatorId: viewerId ?? undefined,
        memberIds: [...memberIds],
        startDate: startDate ?? undefined,
        targetDate: targetDate ?? undefined,
        initiativeIds: initiativeId === null ? [] : [initiativeId],
        labelIds,
        icon: icon === '' ? undefined : icon,
        color: color === '' ? undefined : color,
        ...(templateId === null ? null : { projectTemplateId: templateId }),
      });

      if (another || createMore) {
        // Only the words are cleared. Everything in the pill row is what "create more" is
        // for: a run of projects that share a lead, a timeframe and an initiative.
        setName('');
        setSummary('');
        setDescription('');
        // The dialog is staying open for the next one, so the button has to come back.
        reset();
        nameRef.current?.focus();
        return;
      }
      onClose();
      if (id !== '') void navigate(`/project/${id}`);
    });
  };

  // Read through refs by the registered actions below. `useActions` forwards through the
  // latest render, so this is not what makes the chords correct; it stays because the two
  // submit paths differ only by an argument and read better side by side.
  submitRef.current = () => void save();
  const submitAnotherRef = useRef<() => void>(() => {});
  submitAnotherRef.current = () => void save({ another: true });

  useKeyContext('modal', open);

  /**
   * The property chords, the same letters the project page answers to. They only fire with
   * focus outside a text field — the keymap hands a bare letter to whichever field holds the
   * caret — so they are what Tab-then-`S` does, and what the filter rows teach. Guarded on
   * `confirming`: a picker opened behind the discard question would float over it.
   */
  const openPicker = (show: () => void) => {
    if (!confirming) show();
  };

  useActions(
    open
      ? [
          {
            id: 'project.create.submit',
            title: 'Create project',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Projects',
            // Hidden from the command menu: it means nothing unless this dialog is open, and
            // the dialog already offers the same command as a button.
            hidden: true,
            run: () => submitRef.current(),
          },
          {
            id: 'project.create.submitAndAnother',
            title: 'Create project and start another',
            keys: ['mod+shift+Enter'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => submitAnotherRef.current(),
          },
          {
            id: 'project.create.status',
            title: 'Set project status',
            keys: ['s'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(statusMenu.show),
          },
          {
            id: 'project.create.priority',
            title: 'Set project priority',
            keys: ['p'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(priorityMenu.show),
          },
          {
            id: 'project.create.lead',
            title: 'Set project lead',
            keys: ['a'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(leadMenu.show),
          },
          {
            id: 'project.create.members',
            title: 'Add project members',
            keys: ['m'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(memberMenu.show),
          },
          {
            id: 'project.create.teams',
            title: 'Set project teams',
            keys: ['t'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(teamMenu.show),
          },
          {
            id: 'project.create.startDate',
            title: 'Set project start date',
            keys: ['shift+d'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(startMenu.show),
          },
          {
            id: 'project.create.targetDate',
            title: 'Set project target date',
            keys: ['shift+t'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(targetMenu.show),
          },
          {
            id: 'project.create.initiative',
            title: 'Set project initiative',
            keys: ['i'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(initiativeMenu.show),
          },
          {
            id: 'project.create.labels',
            title: 'Add project labels',
            keys: ['l'],
            when: 'modal',
            group: 'Projects',
            hidden: true,
            run: () => openPicker(labelMenu.show),
          },
        ]
      : [],
    [open],
  );

  const teamItems: MenuNode[] = teams.map((candidate) => ({
    id: candidate.id,
    label: candidate.name,
    text: `${candidate.key} ${candidate.name}`,
    icon: <TeamGlyph icon={candidate.icon} name={candidate.name} id={candidate.id} />,
    hint: candidate.key,
    selected: teamIds.includes(candidate.id),
    onSelect: () =>
      setChosenTeams(() => {
        // A multi-select that cannot empty itself: a project with no team is invisible to
        // everybody, and the API refuses it, so the last one standing is not removable.
        const next = teamIds.includes(candidate.id)
          ? teamIds.filter((id) => id !== candidate.id)
          : [...teamIds, candidate.id];
        return next.length === 0 ? teamIds : next;
      }),
  }));

  const templateItems: MenuNode[] = [
    {
      id: 'none',
      label: 'No template',
      selected: templateId === null,
      onSelect: () => applyTemplate(null),
    },
    ...templates.map((template) => ({
      id: template.id,
      label: template.name,
      selected: template.id === templateId,
      onSelect: () => applyTemplate(template.id),
    })),
  ];

  const memberNames = useLiveQuery(
    (store) =>
      [...memberIds]
        .flatMap((id) => {
          const user = store.users.get(id);
          return user === undefined ? [] : [user.displayName];
        })
        .sort((a, b) => a.localeCompare(b)),
    ['user'],
    [[...memberIds].sort().join(' ')],
  );

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title="New project"
        size="composer"
        // A class rather than a fifth `ModalSize`, for the reason the issue composer gives:
        // "as big as the screen" is this dialog's answer to a long description, not a width
        // other dialogs should be able to ask for.
        className={expanded ? styles.fullScreen : undefined}
        initialFocus={nameRef}
        header={
          <div className={styles.header}>
            <PropertyPill
              {...teamMenu.props}
              name="Team"
              describe={`${formId}-team`}
              icon={
                team === undefined ? null : (
                  <TeamGlyph icon={team.icon} name={team.name} id={team.id} />
                )
              }
              className={styles.teamPill}
            >
              {teamIds.length > 1
                ? `${team?.key ?? '—'} +${teamIds.length - 1}`
                : (team?.key ?? '—')}
            </PropertyPill>
            <span className={styles.crumb} aria-hidden="true">
              <ChevronGlyph />
            </span>
            <span className={styles.heading} aria-hidden="true">
              New project
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
              Create project
            </Button>
          </div>
        }
      >
        <form
          id={formId}
          className={styles.form}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            ref={nameRef}
            label="Name"
            // The placeholder is the label here, which is the one case `hideLabel` is for:
            // a document field whose own text is the heading of the thing being created.
            hideLabel
            surface="bare"
            className={styles.name}
            value={name}
            error={nameError ?? undefined}
            placeholder="Project name"
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (nameError !== null) setNameError(null);
            }}
          />
          <Input
            label="Summary"
            hideLabel
            surface="bare"
            className={styles.summary}
            value={summary}
            placeholder="What does done look like?"
            autoComplete="off"
            onChange={(event) => setSummary(event.target.value)}
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
            "Planned, button, Status" — because a row of values has to be scannable by eye
            and still say what each one is to somebody who cannot see the glyph. A pill with
            nothing in it shows the property's own name and says "No lead", which is the
            value it holds.
          */}
          <div className={styles.properties}>
            <PropertyPill
              {...statusMenu.props}
              name="Status"
              describe={`${formId}-status`}
              icon={<StateIcon category="backlog" color={selectedStatus?.color} decorative />}
            >
              {selectedStatus?.name ?? 'Status'}
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
              {...leadMenu.props}
              name="Lead"
              describe={`${formId}-lead`}
              empty={lead === null ? 'No lead' : undefined}
              icon={
                lead === null ? (
                  <PersonGlyph />
                ) : (
                  <Avatar
                    name={lead.name}
                    src={lead.avatarUrl}
                    size="xs"
                    colorKey={lead.id}
                    decorative
                  />
                )
              }
            >
              {lead?.name ?? 'Lead'}
            </PropertyPill>

            <PropertyPill
              {...memberMenu.props}
              name="Members"
              describe={`${formId}-members`}
              empty={memberIds.size === 0 ? 'No members' : undefined}
              icon={<MembersGlyph />}
            >
              {memberIds.size === 0
                ? 'Members'
                : memberIds.size === 1
                  ? (memberNames[0] ?? '1 member')
                  : `${memberIds.size} members`}
            </PropertyPill>

            <PropertyPill
              {...startMenu.props}
              name="Start date"
              describe={`${formId}-start`}
              empty={startDate === null ? 'No start date' : undefined}
              icon={<CalendarGlyph />}
            >
              {startDate ?? 'Start'}
            </PropertyPill>

            <PropertyPill
              {...targetMenu.props}
              name="Target date"
              describe={`${formId}-target`}
              empty={targetDate === null ? 'No target date' : undefined}
              icon={<CalendarGlyph />}
            >
              {targetDate ?? 'Target'}
            </PropertyPill>

            <PropertyPill
              {...initiativeMenu.props}
              name="Initiative"
              describe={`${formId}-initiative`}
              empty={initiativeName === null ? 'No initiative' : undefined}
              icon={<InitiativeGlyph />}
            >
              {initiativeName ?? 'Initiative'}
            </PropertyPill>

            <PropertyPill
              {...labelMenu.props}
              name="Labels"
              describe={`${formId}-labels`}
              empty={chosenLabels.length === 0 ? 'No labels' : undefined}
              icon={chosenLabels.length === 0 ? <TagGlyph /> : null}
            >
              {chosenLabels.length === 0 ? (
                'Labels'
              ) : (
                <span className={styles.chips}>
                  {chosenLabels.map((label) => (
                    <LabelChip key={label.id} name={label.name} color={label.color} compact />
                  ))}
                </span>
              )}
            </PropertyPill>

            <PropertyPill
              {...iconMenu.props}
              name="Icon and colour"
              describe={`${formId}-icon`}
              empty={icon === '' && color === '' ? 'No icon' : undefined}
              icon={<EntityIcon icon={icon} color={color} fallback={<PaletteGlyph />} size="sm" />}
            >
              {icon === '' && color === '' ? 'Icon' : 'Icon set'}
            </PropertyPill>

            {/*
              Only where the team offers one. A template picker with nothing in it is a dead
              end rather than a property, which is the rule the issue composer applies to its
              own template and form pills.
            */}
            {templates.length === 0 ? null : (
              <PropertyPill
                {...templateMenu.props}
                name="Template"
                describe={`${formId}-template`}
                empty={templateName === null ? 'No template' : undefined}
                icon={<TemplateGlyph />}
              >
                {templateName ?? 'Template'}
              </PropertyPill>
            )}
          </div>

          {saveError === null ? null : (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
        </form>
      </Modal>

      <Menu
        open={teamMenu.open}
        onClose={teamMenu.hide}
        trigger={teamMenu.ref}
        items={teamItems}
        label="Teams"
        filterable
        filterPlaceholder="Team…"
        filterHint="t"
        emptyLabel="No teams match"
      />

      <ProjectStatusPicker
        open={statusMenu.open}
        onClose={statusMenu.hide}
        trigger={statusMenu.ref}
        value={selectedStatus?.id}
        onSelect={(id) => {
          setStatusId(id);
          statusMenu.hide();
        }}
      />

      <PriorityPicker
        open={priorityMenu.open}
        onClose={priorityMenu.hide}
        trigger={priorityMenu.ref}
        value={priority}
        onSelect={(next) => {
          setPriority(next);
          priorityMenu.hide();
        }}
      />

      <UserPicker
        open={leadMenu.open}
        onClose={leadMenu.hide}
        trigger={leadMenu.ref}
        value={leadId}
        onSelect={(id) => {
          setLeadId(id);
          leadMenu.hide();
        }}
        label="Lead"
        noneLabel="No lead"
        filterPlaceholder="Lead…"
        filterHint="a"
      />

      <UserPicker
        open={memberMenu.open}
        onClose={memberMenu.hide}
        trigger={memberMenu.ref}
        multiple
        value={memberIds}
        onToggle={(id) =>
          setMemberIds((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
          })
        }
        label="Members"
        filterPlaceholder="Add member…"
        filterHint="m"
      />

      <DatePicker
        open={startMenu.open}
        onClose={startMenu.hide}
        trigger={startMenu.ref}
        value={startDate}
        timezone={timezone}
        onSelect={(day) => {
          setStartDate(day);
          startMenu.hide();
        }}
        // Distinct from the target panel's, because both are mounted at once and the
        // registry throws rather than letting one Escape quietly shadow the other.
        actionId="project.closeStartDate"
        actionGroup="Projects"
        label="Start date"
        clearLabel="No start date"
      />

      <DatePicker
        open={targetMenu.open}
        onClose={targetMenu.hide}
        trigger={targetMenu.ref}
        value={targetDate}
        timezone={timezone}
        onSelect={(day) => {
          setTargetDate(day);
          targetMenu.hide();
        }}
        actionId="project.closeTargetDate"
        actionGroup="Projects"
        label="Target date"
        clearLabel="No target date"
      />

      <InitiativePicker
        open={initiativeMenu.open}
        onClose={initiativeMenu.hide}
        trigger={initiativeMenu.ref}
        value={initiativeId}
        onSelect={(id) => {
          setInitiativeId(id);
          initiativeMenu.hide();
        }}
        filterHint="i"
      />

      <ProjectLabelPicker
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

      <IconPicker
        open={iconMenu.open}
        onClose={iconMenu.hide}
        trigger={iconMenu.ref}
        value={{ icon, color }}
        onChange={(next) => {
          setIcon(next.icon);
          setColor(next.color);
        }}
        actionId="project.create.closeIconPicker"
        label="Project icon"
      />

      {templates.length === 0 ? null : (
        <Menu
          open={templateMenu.open}
          onClose={templateMenu.hide}
          trigger={templateMenu.ref}
          items={templateItems}
          label="Template"
          filterable
          filterPlaceholder="Template…"
          emptyLabel="No templates match"
        />
      )}

      {confirming ? (
        <ConfirmDialog
          open
          title="Discard this project?"
          consequence="What you have written here has not been saved anywhere else, and closing the dialog throws it away."
          confirmLabel="Discard"
          destructive
          onConfirm={discard}
          onClose={keep}
        />
      ) : null}
    </>
  );
}

function useTeamKeyInPath(): string | null {
  const { pathname } = useLocation();
  return useMemo(() => /^\/team\/([^/]+)/.exec(pathname)?.[1] ?? null, [pathname]);
}

/** The team's emoji where it set one; its initial on the identity ramp where it did not. */
function TeamGlyph({ icon, name, id }: { icon: string | undefined; name: string; id: UUID }) {
  if (icon !== undefined && icon !== '') {
    return (
      <span className={styles.emoji} aria-hidden="true">
        {icon}
      </span>
    );
  }
  return <Avatar name={name} size="xs" colorKey={id} decorative />;
}

const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
} as const;

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {children}
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <Glyph>
      <path d="m6 4 4 4-4 4" {...STROKE} />
    </Glyph>
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
    <Glyph>
      <circle cx="8" cy="8" r="6" {...STROKE} />
      <circle cx="8" cy="6.5" r="2" {...STROKE} />
      <path d="M4.2 12.3a4.5 4.5 0 0 1 7.6 0" {...STROKE} />
    </Glyph>
  );
}

function MembersGlyph() {
  return (
    <Glyph>
      <circle cx="6" cy="6.5" r="2.25" {...STROKE} />
      <path d="M2.5 13a3.75 3.75 0 0 1 7 0" {...STROKE} />
      <path d="M10.5 4.6a2.25 2.25 0 0 1 0 3.8M11.5 13a3.75 3.75 0 0 0-1.2-2.75" {...STROKE} />
    </Glyph>
  );
}

function CalendarGlyph() {
  return (
    <Glyph>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" {...STROKE} />
      <path d="M2.5 6.5h11M5.5 2v2.5m5-2.5v2.5" {...STROKE} />
    </Glyph>
  );
}

function InitiativeGlyph() {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="5.25" {...STROKE} />
      <circle cx="8" cy="8" r="2" {...STROKE} />
      <path d="M8 2.75v2M8 11.25v2M2.75 8h2M11.25 8h2" {...STROKE} />
    </Glyph>
  );
}

function TagGlyph() {
  return (
    <Glyph>
      <path d="M2.5 8.5V3a.5.5 0 0 1 .5-.5h5.5l5 5-6 6z" {...STROKE} />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
    </Glyph>
  );
}

function TemplateGlyph() {
  return (
    <Glyph>
      <path d="M4 2.5h5.5l3 3V13.5H4z" {...STROKE} />
      <path d="M9.5 2.5v3h3M6 8.5h4M6 11h4" {...STROKE} />
    </Glyph>
  );
}

function PaletteGlyph() {
  return (
    <Glyph>
      <path
        d="M8 2.5a5.5 5.5 0 0 0 0 11c.83 0 1.25-.6 1.25-1.25 0-.86-.75-1.15-.75-1.9 0-.5.4-.85.9-.85h1.35A2.75 2.75 0 0 0 13.5 6.7C13.5 4.3 11 2.5 8 2.5Z"
        {...STROKE}
      />
      <circle cx="5.5" cy="7" r=".9" fill="currentColor" />
      <circle cx="8" cy="5.5" r=".9" fill="currentColor" />
    </Glyph>
  );
}
