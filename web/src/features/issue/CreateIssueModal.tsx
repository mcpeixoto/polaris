/**
 * The create-issue modal, reached with `C` from anywhere.
 *
 * It is the fastest path in the product and the one the whole optimistic architecture is
 * justified by: type a title, press ⌘⏎, and the issue is in the list on the next frame
 * whether or not the server has heard about it yet. Everything about the screen is arranged
 * around that — focus lands in the title field, every other field is reachable with Tab and
 * operable with the arrow keys, and nothing waits on the network before closing.
 *
 * Team, status, assignee and priority are native `<Select>`s rather than the Menu-based
 * pickers the list and the detail view use, and that is a deliberate split rather than an
 * inconsistency. In those places changing a status is a *command* — it has a shortcut, it
 * acts on a selection, it wants a filter. Here it is a form field being filled in on the
 * way to a submit, where the platform's own control is better at everything that matters:
 * it tabs, it types ahead, it opens as a wheel on a phone, and it needs no focus trap of
 * its own inside a dialog that already has one.
 *
 * Project, cycle and template stay Menu pickers: ranking and typeahead are the whole point of
 * those lists, and a native select cannot do either.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { createDraft, deleteDraft, updateDraft } from '~/features/drafts/mutations';
import { readIssueComposerDraft, writeIssueComposerDraft } from '~/features/drafts/local';
import { getPrefs } from '~/features/prefs/prefs';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import {
  CATEGORY_ORDER,
  type IssueTemplate,
  type RecurringCadence,
  type StateCategory,
  type UUID,
  type WorkflowState,
} from '~/store';
import { ApiError } from '~/sync/api';
import { createIssue } from './mutations';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { templateDefaults, type TemplateDefaults } from '~/features/templates/mutations';
import { fieldsForFormTemplate } from '~/features/form-templates/mutations';
import { FormTemplatePicker } from '~/features/form-templates/FormTemplatePicker';
import {
  FormFillFields,
  descriptionFromFormAnswers,
  priorityFromFormAnswers,
  titleFromFormAnswers,
  type FormAnswers,
} from '~/features/form-templates/FormFillFields';
import type { FormTemplate } from '~/store';
import { TemplatePicker } from '~/features/templates/TemplatePicker';
import { CyclePicker } from '~/features/cycles/CyclePicker';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { buildCreateURL, type IssueComposerSeed } from './create-url';
import { CADENCE_LABELS, CADENCES, defaultTemplateFor } from '~/features/recurring/mutations';
import { today } from '~/features/time';
import styles from './CreateIssueModal.module.css';

export interface CreateIssueModalProps {
  onClose: () => void;
  seed?: IssueComposerSeed | undefined;
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

function isBlankSeed(seed: IssueComposerSeed | undefined): boolean {
  if (seed === undefined) return true;
  return (
    seed.draftId === undefined &&
    seed.templateId === undefined &&
    seed.title === undefined &&
    seed.description === undefined &&
    seed.teamId === undefined &&
    seed.teamKey === undefined &&
    seed.stateId === undefined &&
    seed.assigneeId === undefined &&
    seed.priority === undefined &&
    seed.estimate === undefined &&
    seed.cycleId === undefined &&
    seed.projectId === undefined &&
    (seed.labelIds === undefined || seed.labelIds.length === 0)
  );
}

export function CreateIssueModal({ onClose, seed }: CreateIssueModalProps) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const formId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const local = isBlankSeed(seed) ? readIssueComposerDraft() : null;

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .map((team) => ({
          id: team.id,
          key: team.key,
          name: team.name,
          timezone: team.timezone,
          cyclesEnabled: team.cyclesEnabled,
          triageEnabled: team.triageEnabled,
        }))
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

  const [chosenTeam, setChosenTeam] = useState<UUID | null>(
    () => seed?.teamId ?? local?.teamId ?? null,
  );
  const [chosenState, setChosenState] = useState<UUID | null>(
    () => seed?.stateId ?? local?.stateId ?? null,
  );
  const [title, setTitle] = useState(() => seed?.title ?? local?.title ?? '');
  const [description, setDescription] = useState(
    () => seed?.description ?? local?.description ?? '',
  );
  const [assigneeId, setAssigneeId] = useState<UUID>(() => {
    const raw = seed?.assigneeId ?? local?.assigneeId;
    if (raw === undefined) return UNASSIGNED;
    if (raw === 'me') return UNASSIGNED;
    return raw;
  });
  const [priority, setPriority] = useState(() => seed?.priority ?? local?.priority ?? 0);
  // `undefined` means inherit from `/project/:id`; `null` means the filer cleared it.
  const [projectId, setProjectId] = useState<UUID | null | undefined>(
    () => seed?.projectId ?? local?.projectId ?? undefined,
  );
  const [cycleId, setCycleId] = useState<UUID | null | undefined>(
    () => seed?.cycleId ?? local?.cycleId ?? undefined,
  );
  const [labelIds] = useState<readonly UUID[] | undefined>(() => seed?.labelIds);
  const estimate = seed?.estimate ?? local?.estimate;
  const [template, setTemplate] = useState<TemplateDefaults | null>(null);
  const [formTemplate, setFormTemplate] = useState<FormTemplate | null>(null);
  const [formAnswers, setFormAnswers] = useState<FormAnswers>({});
  /**
   * How the template field got to its current value.
   *
   * `auto` is the team's member/non-member default, re-applied when the team changes.
   * `cleared` is the filer saying they do not want that default — `skipDefaultTemplate`
   * on the create, or the server would put it back. An explicit pick is neither.
   */
  const [templateIntent, setTemplateIntent] = useState<'auto' | 'cleared' | 'chosen'>('auto');
  const [cadence, setCadence] = useState<RecurringCadence | null>(null);
  const [firstDueDate, setFirstDueDate] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const submitted = useRef(false);

  // The team the user is looking at, read from the path rather than passed in. This modal is
  // mounted by the shell, above the route that knows which team is on screen, so `useParams`
  // here would answer for a route that has not matched.
  const fromPath = useTeamKeyInPath();
  const fromTriagePath = useTriagePath();
  const fromProjectPath = useProjectIdInPath();
  const fromCyclePath = useCycleIdInPath();
  const cycleFromPath = useLiveQuery(
    (store) => (fromCyclePath === null ? null : (store.cycles.get(fromCyclePath) ?? null)),
    ['cycle'],
    [fromCyclePath ?? ''],
  );

  /**
   * The team the issue will belong to.
   *
   * Derived rather than stored, so that a replica which finishes hydrating after the dialog
   * opened still lands on a real team instead of leaving the field on a value that was empty
   * when the first render happened.
   */
  const teamId = useMemo(() => {
    if (chosenTeam !== null && teams.some((team) => team.id === chosenTeam)) return chosenTeam;
    const fromKey = teams.find((team) => team.key === fromPath)?.id;
    if (fromKey !== undefined) return fromKey;
    if (cycleFromPath !== null && teams.some((team) => team.id === cycleFromPath.teamId)) {
      return cycleFromPath.teamId;
    }
    return teams[0]?.id ?? '';
  }, [chosenTeam, teams, fromPath, cycleFromPath]);

  const resolvedProjectId = projectId === undefined ? fromProjectPath : projectId;
  const resolvedCycleId = cycleId === undefined ? fromCyclePath : cycleId;
  const team = teams.find((candidate) => candidate.id === teamId);
  const teamRunsCycles = team?.cyclesEnabled === true;
  const teamTimezone = team?.timezone ?? 'UTC';
  const fromTriage = fromTriagePath && team?.triageEnabled === true;

  const templateMenu = useMenuTrigger();
  const formTemplateMenu = useMenuTrigger();
  const projectMenu = useMenuTrigger();
  const cycleMenu = useMenuTrigger();

  const formFields = useLiveQuery(
    (store) => (formTemplate === null ? [] : fieldsForFormTemplate(store, formTemplate.id)),
    ['formTemplateField'],
    [formTemplate?.id ?? ''],
  );

  const formTemplateName = formTemplate?.name ?? null;

  const templateName = useLiveQuery(
    (store) =>
      template === null ? null : (store.issueTemplates.get(template.templateId)?.name ?? null),
    ['issueTemplate'],
    [template?.templateId ?? ''],
  );

  const projectName = useLiveQuery(
    (store) =>
      resolvedProjectId === null ? null : (store.projects.get(resolvedProjectId)?.name ?? null),
    ['project'],
    [resolvedProjectId ?? ''],
  );

  const cycleName = useLiveQuery(
    (store) =>
      resolvedCycleId === null ? null : (store.cycles.get(resolvedCycleId)?.name ?? null),
    ['cycle'],
    [resolvedCycleId ?? ''],
  );

  /**
   * Applies a template's prefill to the form.
   *
   * Into the *form's* state rather than straight into a create, because a template is a
   * starting point and not a submission: the whole value of prefilling is that the filer then
   * edits it. Title and body are only overwritten when the template actually supplies them,
   * so choosing a template after typing does not silently discard what was typed.
   */
  const applyTemplate = useCallback(
    (chosen: IssueTemplate | null) => {
      if (chosen === null) {
        setTemplate(null);
        return;
      }
      setFormTemplate(null);
      setFormAnswers({});
      const defaults = templateDefaults(engine.store, chosen, teamId);
      setTemplate(defaults);
      if (defaults.title !== '') setTitle(defaults.title);
      if (defaults.description !== '') setDescription(defaults.description);
      // `chosenState` and not the derived `stateId`: the derived value is recomputed from the
      // team, and writing it there would be overwritten on the next render.
      if (defaults.stateId !== undefined) setChosenState(defaults.stateId);
      setAssigneeId(defaults.assigneeId ?? UNASSIGNED);
      setPriority(defaults.priority ?? 0);
    },
    [engine.store, teamId],
  );

  const applyFormTemplate = (chosen: FormTemplate | null) => {
    setFormTemplate(chosen);
    setFormAnswers({});
    setTemplate(null);
    if (chosen === null) return;
    if (chosen.properties.priority !== undefined) setPriority(chosen.properties.priority);
  };

  const pickTemplate = (chosen: IssueTemplate | null) => {
    if (chosen === null) {
      setTemplateIntent('cleared');
      setTemplate(null);
      return;
    }
    setTemplateIntent('chosen');
    applyTemplate(chosen);
  };

  const defaultTemplateId = useLiveQuery(
    (store) => defaultTemplateFor(store, teamId, viewerId)?.id ?? null,
    ['team', 'issueTemplate', 'teamMembership'],
    [teamId, viewerId ?? ''],
  );

  useEffect(() => {
    if (templateIntent !== 'auto') return;
    const chosen =
      defaultTemplateId === null
        ? null
        : (engine.store.get('issueTemplate', defaultTemplateId) ?? null);
    applyTemplate(chosen);
    // The team's default is a reaction to the team (and who is filing) changing, not to
    // every keystroke in the form. Re-running because `applyTemplate` closed over title
    // would overwrite what the filer just typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, defaultTemplateId, templateIntent]);
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
    if (fromTriage) {
      return (
        (
          states.find((state) => state.category === 'triage') ??
          states.find((state) => state.isDefault) ??
          states[0]
        )?.id ?? ''
      );
    }
    return (states.find((state) => state.isDefault) ?? states[0])?.id ?? '';
  }, [chosenState, states, fromTriage]);

  const seededTemplate = useRef(false);
  useEffect(() => {
    if (seededTemplate.current || teamId === '' || seed?.templateId === undefined) return;
    const chosen = engine.store.issueTemplates.get(seed.templateId);
    if (chosen === undefined) return;
    seededTemplate.current = true;
    applyTemplate(chosen);
    if (seed.title !== undefined) setTitle(seed.title);
    if (seed.description !== undefined) setDescription(seed.description);
    if (seed.priority !== undefined) setPriority(seed.priority);
    if (seed.stateId !== undefined) setChosenState(seed.stateId);
    if (seed.assigneeId !== undefined && seed.assigneeId !== 'me') setAssigneeId(seed.assigneeId);
  }, [applyTemplate, engine.store, seed, teamId]);

  const assignedOnce = useRef(false);
  useEffect(() => {
    if (assignedOnce.current || viewerId === null) return;
    if (
      seed?.assigneeId === 'me' ||
      (seed?.assigneeId === undefined && local === null && getPrefs().autoAssignOnCreate)
    ) {
      if (assigneeId === UNASSIGNED) setAssigneeId(viewerId);
    }
    assignedOnce.current = true;
  }, [assigneeId, local, seed?.assigneeId, viewerId]);

  useEffect(() => {
    if (submitted.current) return;
    writeIssueComposerDraft({
      kind: 'issue',
      title,
      description,
      ...(teamId === '' ? null : { teamId }),
      ...(stateId === '' ? null : { stateId }),
      ...(assigneeId === UNASSIGNED ? null : { assigneeId }),
      priority,
      ...(resolvedProjectId === null || resolvedProjectId === undefined
        ? null
        : { projectId: resolvedProjectId }),
      ...(resolvedCycleId === null || resolvedCycleId === undefined
        ? null
        : { cycleId: resolvedCycleId }),
      ...(estimate === undefined ? null : { estimate }),
      updatedAt: new Date().toISOString(),
    });
  }, [
    assigneeId,
    description,
    estimate,
    priority,
    resolvedCycleId,
    resolvedProjectId,
    stateId,
    teamId,
    title,
  ]);

  const dirty = title.trim() !== '' || description.trim() !== '';

  const leave = () => {
    submitted.current = true;
    setLeaving(false);
    onClose();
  };

  const requestClose = () => {
    if (leaving) return;
    if (!dirty) {
      writeIssueComposerDraft(null);
      leave();
      return;
    }
    setLeaving(true);
    setDraftError(null);
  };

  const discardAndLeave = async () => {
    writeIssueComposerDraft(null);
    if (seed?.draftId !== undefined) {
      try {
        await deleteDraft(seed.draftId);
      } catch {
        /* local already gone; a failed delete leaves the saved copy to discard from Drafts */
      }
    }
    leave();
  };

  const saveDraftAndLeave = async () => {
    setDraftBusy(true);
    setDraftError(null);
    const payload = {
      title: title.trim(),
      description: description.trim(),
      ...(teamId === '' ? null : { teamId }),
      ...(stateId === '' ? null : { stateId }),
      ...(assigneeId === UNASSIGNED ? null : { assigneeId }),
      priority,
      ...(resolvedProjectId === null || resolvedProjectId === undefined
        ? null
        : { projectId: resolvedProjectId }),
      ...(resolvedCycleId === null || resolvedCycleId === undefined
        ? null
        : { cycleId: resolvedCycleId }),
      ...(estimate === undefined ? null : { estimate }),
    };
    try {
      if (seed?.draftId !== undefined) await updateDraft(seed.draftId, payload);
      else await createDraft({ kind: 'issue', payload });
      writeIssueComposerDraft(null);
      leave();
    } catch (failure) {
      setDraftBusy(false);
      setDraftError(
        failure instanceof ApiError ? failure.message : 'The draft could not be saved.',
      );
    }
  };

  const copyCreateUrl = () => {
    const team = teams.find((item) => item.id === teamId);
    const state = states.find((item) => item.id === stateId);
    const person = people.find((item) => item.id === assigneeId);
    const url = buildCreateURL({
      teamKey: team?.key,
      title: title.trim() === '' ? undefined : title.trim(),
      description: description.trim() === '' ? undefined : description.trim(),
      statusName: state?.name,
      priority,
      assignee: person?.name,
      estimate,
      cycle: cycleName ?? undefined,
      project: projectName ?? undefined,
      template: templateName ?? undefined,
    });
    void navigator.clipboard?.writeText(`${window.location.origin}${url}`);
  };

  const save = async () => {
    if (saving) return;
    const trimmed = title.trim();
    const resolvedTitle =
      formTemplate === null
        ? trimmed
        : titleFromFormAnswers(formFields, formAnswers, trimmed).trim();
    if (resolvedTitle === '') {
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
        title: resolvedTitle,
        description:
          formTemplate === null
            ? description.trim()
            : [description.trim(), descriptionFromFormAnswers(formFields, formAnswers)]
                .filter((part) => part !== '')
                .join('\n\n'),
        stateId: stateId === '' ? undefined : stateId,
        assigneeId: assigneeId === UNASSIGNED ? undefined : assigneeId,
        priority:
          formTemplate === null
            ? priority
            : priorityFromFormAnswers(formFields, formAnswers, priority),
        ...(estimate === undefined ? null : { estimate }),
        ...(labelIds === undefined || labelIds.length === 0 ? null : { labelIds: [...labelIds] }),
        ...(seed?.projectMilestoneId === undefined
          ? null
          : { projectMilestoneId: seed.projectMilestoneId }),
        ...(resolvedProjectId === null ? null : { projectId: resolvedProjectId }),
        ...(resolvedCycleId === null || !teamRunsCycles ? null : { cycleId: resolvedCycleId }),
        ...(fromTriage ? { fromTriage: true } : null),
        // The template's own contributions, carried on the create rather than applied
        // afterwards: three follow-up writes for one filed issue would be three versions on
        // the stream and three frames in which the issue is not yet what the template says
        // it is.
        ...(template === null
          ? null
          : {
              templateId: template.templateId,
              ...(template.estimate === undefined ? null : { estimate: template.estimate }),
              ...(template.labelIds.length === 0 ? null : { labelIds: template.labelIds }),
            }),
        ...(formTemplate === null ? null : { formTemplateId: formTemplate.id }),
        ...(templateIntent === 'cleared' ? { skipDefaultTemplate: true } : null),
        ...(cadence === null
          ? null
          : {
              recurringCadence: cadence,
              recurringFirstDueDate: firstDueDate === '' ? today(teamTimezone) : firstDueDate,
              dueDate: firstDueDate === '' ? today(teamTimezone) : firstDueDate,
            }),
        creatorId: viewerId ?? undefined,
      });
      writeIssueComposerDraft(null);
      if (seed?.draftId !== undefined) void deleteDraft(seed.draftId);
      submitted.current = true;
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
  const copyRef = useRef<() => void>(() => {});
  copyRef.current = copyCreateUrl;

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
      {
        id: 'issue.copyComposerUrl',
        title: 'Copy pre-filled create URL',
        when: 'modal',
        group: 'Issues',
        run: () => copyRef.current(),
      },
    ],
    [],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return (
    <>
      <Modal
        open
        onClose={requestClose}
        title="New issue"
        size="lg"
        initialFocus={titleRef}
        footer={
          <>
            <Button onClick={requestClose}>Cancel</Button>
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
            hideLabel
            surface="plain"
            value={title}
            error={titleError ?? undefined}
            placeholder="Issue title"
            autoComplete="off"
            onChange={(event) => {
              setTitle(event.target.value);
              if (titleError !== null) setTitleError(null);
            }}
          />

          <Textarea
            label="Description"
            hideLabel
            surface="plain"
            value={description}
            minRows={3}
            maxRows={12}
            placeholder="Add a description…"
            onChange={(event) => setDescription(event.target.value)}
          />

          <div className={styles.properties}>
            <Select
              label="Team"
              hideLabel
              value={teamId}
              onChange={(event) => {
                setChosenTeam(event.target.value);
                setChosenState(null);
                setCycleId(null);
                // The offering is team-scoped, so a template chosen for one team is not a
                // template in another. Back to `auto` rather than `cleared`: the new team's
                // default is a different template, and silently keeping "no template" across
                // that change would skip a default the filer never saw.
                setTemplateIntent('auto');
                setTemplate(null);
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
              hideLabel
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
              hideLabel
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
              hideLabel
              value={String(priority)}
              onChange={(event) => setPriority(Number(event.target.value))}
            >
              {PRIORITY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {priorityLabel(level)}
                </option>
              ))}
            </Select>

            <div className={styles.template}>
              <span className={styles.templateLabel} id={`${formId}-project`}>
                Project
              </span>
              <Button
                {...projectMenu.props}
                variant="ghost"
                fullWidth
                aria-describedby={`${formId}-project`}
              >
                {projectName ?? 'No project'}
              </Button>
            </div>

            {teamRunsCycles ? (
              <div className={styles.template}>
                <span className={styles.templateLabel} id={`${formId}-cycle`}>
                  Cycle
                </span>
                <Button
                  {...cycleMenu.props}
                  variant="ghost"
                  fullWidth
                  aria-describedby={`${formId}-cycle`}
                >
                  {cycleName ?? 'No cycle'}
                </Button>
              </div>
            ) : null}

            <div className={styles.template}>
              <span className={styles.templateLabel} id={`${formId}-template`}>
                Template
              </span>
              <Button
                {...templateMenu.props}
                variant="ghost"
                fullWidth
                aria-describedby={`${formId}-template`}
                disabled={teamId === ''}
              >
                {templateName ?? 'No template'}
              </Button>
            </div>

            <div className={styles.template}>
              <span className={styles.templateLabel} id={`${formId}-form-template`}>
                Form
              </span>
              <Button
                {...formTemplateMenu.props}
                variant="ghost"
                fullWidth
                aria-describedby={`${formId}-form-template`}
                disabled={teamId === ''}
              >
                {formTemplateName ?? 'No form'}
              </Button>
            </div>

            <Select
              label="Repeat"
              hideLabel
              value={cadence ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                if (next === '') {
                  setCadence(null);
                  return;
                }
                setCadence(next as RecurringCadence);
                if (firstDueDate === '') setFirstDueDate(today(teamTimezone));
              }}
            >
              <option value="">Does not repeat</option>
              {CADENCES.map((option) => (
                <option key={option} value={option}>
                  {CADENCE_LABELS[option]}
                </option>
              ))}
            </Select>

            {cadence === null ? null : (
              <Input
                label="First due"
                hideLabel
                type="date"
                value={firstDueDate === '' ? today(teamTimezone) : firstDueDate}
                onChange={(event) => setFirstDueDate(event.target.value)}
              />
            )}
          </div>

          {formTemplate !== null && formFields.length > 0 ? (
            <FormFillFields
              fields={formFields}
              answers={formAnswers}
              onChange={(fieldId, value) =>
                setFormAnswers((prev) => ({ ...prev, [fieldId]: value }))
              }
            />
          ) : null}

          {saveError === null ? null : (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}
          {/*
          Said out loud, because the alternative is silence about a decision the product made
          on the filer's behalf. A workspace template cannot carry a status — a status belongs
          to one team — so applying one to a team that has statuses drops it, and somebody who
          watched a field not fill in deserves to know it was not a bug.
        */}
          {template !== null && template.dropped.length > 0 && (
            <p className={styles.dropped} role="status">
              {`This template does not set ${listOf(template.dropped)} for this team.`}
            </p>
          )}
        </form>

        <ProjectPicker
          open={projectMenu.open}
          onClose={projectMenu.hide}
          trigger={projectMenu.ref}
          teamIds={teamId === '' ? [] : [teamId]}
          value={resolvedProjectId}
          onSelect={setProjectId}
        />
        <CyclePicker
          open={cycleMenu.open}
          onClose={cycleMenu.hide}
          trigger={cycleMenu.ref}
          teamId={teamId === '' ? undefined : teamId}
          value={resolvedCycleId}
          onSelect={setCycleId}
        />
        <TemplatePicker
          open={templateMenu.open}
          onClose={templateMenu.hide}
          trigger={templateMenu.ref}
          teamId={teamId}
          value={template?.templateId ?? null}
          onSelect={pickTemplate}
        />
        <FormTemplatePicker
          open={formTemplateMenu.open}
          onClose={formTemplateMenu.hide}
          trigger={formTemplateMenu.ref}
          teamId={teamId}
          value={formTemplate?.id ?? null}
          onSelect={applyFormTemplate}
        />
      </Modal>
      {leaving ? (
        <Modal
          open
          onClose={() => setLeaving(false)}
          title="Save this as a draft?"
          size="sm"
          footer={
            <>
              <Button variant="danger" onClick={() => void discardAndLeave()}>
                Discard
              </Button>
              <Button onClick={() => setLeaving(false)}>Keep editing</Button>
              <Button
                variant="primary"
                loading={draftBusy}
                onClick={() => void saveDraftAndLeave()}
              >
                Save as draft
              </Button>
            </>
          }
        >
          <p className={styles.dropped}>
            Walking away keeps a local copy on this device until you log out. Saving puts it on
            every device for six months.
          </p>
          {draftError === null ? null : (
            <p className={styles.error} role="alert">
              {draftError}
            </p>
          )}
        </Modal>
      ) : null}
    </>
  );
}

function useTeamKeyInPath(): string | null {
  const { pathname } = useLocation();
  return useMemo(() => /^\/team\/([^/]+)/.exec(pathname)?.[1] ?? null, [pathname]);
}

function useTriagePath(): boolean {
  const { pathname } = useLocation();
  return useMemo(() => /\/team\/[^/]+\/triage(?:\/|$)/.test(pathname), [pathname]);
}

function useProjectIdInPath(): UUID | null {
  const { pathname } = useLocation();
  return useMemo(() => /^\/project\/([^/]+)/.exec(pathname)?.[1] ?? null, [pathname]);
}

function useCycleIdInPath(): UUID | null {
  const { pathname } = useLocation();
  return useMemo(() => /^\/cycle\/([^/]+)/.exec(pathname)?.[1] ?? null, [pathname]);
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

/**
 * "status", "status and assignee", "status, assignee and one label".
 *
 * A comma-separated list reads as a machine's output; this sentence is shown to somebody who
 * has just watched a field not fill in, and it should read like an explanation.
 */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}
