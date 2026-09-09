/**
 * The create-issue modal, reached with `C` from anywhere.
 *
 * It is the fastest path in the product and the one the whole optimistic architecture is
 * justified by: type a title, press ⌘⏎, and the issue is in the list on the next frame
 * whether or not the server has heard about it yet. Everything about the screen is arranged
 * around that — focus lands in the title field, every other field is reachable with Tab and
 * operable with the arrow keys, and nothing waits on the network before closing.
 *
 * It reads top to bottom as a breadcrumb, a document and a row of properties. The header
 * says which team the issue is going into — a chip that opens the team picker — and the
 * title and description below it are unboxed, because they are the issue and not a form
 * about one. Every property is a pill: the value's own glyph and its name when it is set,
 * the property's glyph and its name when it is not, and every one of them opens the same
 * Menu picker the list and the detail view use, with a filter box that teaches the chord
 * that would have opened it (`S`, `P`, `A`, `L`…). Native `<select>`s used to stand in for
 * the four commonest of these, on the argument that a form field is not a command; the
 * argument was sound and the result was a dialog that looked like nothing else in the
 * product, with a status control that could not show the status's colour.
 *
 * Properties that most issues never set — a due date, a repeat cadence — stay out of the
 * row until asked for from the `…` pill, and come back on their own the moment they hold a
 * value. Template and form pills appear where the team offers any, because a picker with
 * nothing in it is a dead end and not a property.
 *
 * "Create more" is a switch rather than a second button, because it changes what the primary
 * button does rather than being a different thing to do: with it on, `Create issue` and ⌘⏎
 * file and stay for the next one. ⌘⇧⏎ still does that whatever the switch says.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  IconButton,
  Input,
  LabelChip,
  Menu,
  Modal,
  priorityLabel,
  PriorityIcon,
  PRIORITY_LEVELS,
  PropertyPill,
  StateIcon,
  STATE_LABELS,
  Switch,
  Textarea,
  type MenuNode,
} from '~/components';
import { createDraft, deleteDraft, updateDraft } from '~/features/drafts/mutations';
import { estimateLabel, estimateOptions, estimatesEnabled } from '~/features/estimate';
import { LabelPicker } from '~/features/labels/LabelPicker';
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
import { DueDatePicker, DueDateValue } from './properties';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { templateDefaults, type TemplateDefaults } from '~/features/templates/mutations';
import { placeholderSpans, unwrapPlaceholders } from '~/features/templates/placeholder';
import { fieldsForFormTemplate, formTemplatesForTeam } from '~/features/form-templates/mutations';
import { FormTemplatePicker } from '~/features/form-templates/FormTemplatePicker';
import {
  FormFillFields,
  descriptionFromFormAnswers,
  priorityFromFormAnswers,
  titleFromFormAnswers,
  type FormAnswers,
} from '~/features/form-templates/FormFillFields';
import type { FormTemplate } from '~/store';
import { TemplatePicker, templatesForTeam } from '~/features/templates/TemplatePicker';
import { CyclePicker } from '~/features/cycles/CyclePicker';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { buildCreateURL, type IssueComposerSeed } from './create-url';
import { CADENCE_LABELS, CADENCES, defaultTemplateFor } from '~/features/recurring/mutations';
import { today } from '~/features/time';
import styles from './CreateIssueModal.module.css';

export interface CreateIssueModalProps {
  /**
   * Whether the composer is up.
   *
   * The shell mounts this component unconditionally and tells it, rather than rendering it
   * into existence, for the reason `Peek` is mounted the same way: a dialog cannot animate
   * its own removal from a tree it has already left, so the `scrimOut`/`dialogOut` exit was
   * dead for the one dialog the product opens most. Everything that would cost something
   * while shut is gated on this — the modal context, the registered chords and the local
   * draft's autosave — so a closed composer claims no keys and writes nothing.
   *
   * Defaults to true, which is the contract this component had before the prop existed:
   * something that mounted it meant it.
   */
  open?: boolean | undefined;
  onClose: () => void;
  seed?: IssueComposerSeed | undefined;
  /**
   * Called with `true` when a create leaves for the server, and with `false` if it comes
   * back refused.
   *
   * The shell drops a second `C` while a composer is up, because a composer that is up is
   * holding a half-written issue. That stops being true the moment the issue is filed: the
   * dialog is then a receipt waiting on a round trip, and somebody filing a run of issues
   * presses `C` inside that window constantly. Without this the shell cannot tell the two
   * apart and the shortcut looks like it works about half the time.
   */
  onFiling?: ((filing: boolean) => void) | undefined;
  /**
   * The issue's id, once the server has taken it.
   *
   * "Create related ▸ Blocked issue…" is two writes: the issue, then the relation that says
   * what it is to the issue it was filed from. Only the second one needs an id, and nothing
   * outside this dialog knows when there is one — the composer stays open for "create more",
   * and an opener watching `onClose` would write its relation against the wrong issue or none.
   */
  onCreated?: ((issueId: UUID) => void) | undefined;
}

interface StateOption {
  readonly id: UUID;
  readonly name: string;
  /** The workspace's own colour for the state, so the trigger's glyph is the rail's glyph. */
  readonly color: string;
  readonly category: StateCategory;
  readonly position: string;
  readonly isDefault: boolean;
}

/** The empty value of the assignee. Kept as a string so the local slot's shape is unchanged. */
const UNASSIGNED = '';

/**
 * The properties that wait in the `…` pill until they are asked for.
 *
 * Due date and repeat are set on a small minority of issues and would otherwise be two
 * pills on every composer for the few that need them. Template and form are here for a
 * different reason: they are shown in the row whenever the team offers any, so the overflow
 * is only how they are reached on a team that offers none — which is `Alt+C` on such a
 * team, and the empty picker it opens says why there is nothing to choose.
 */
type Extra = 'due' | 'repeat' | 'template' | 'form';

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
    seed.parentId === undefined &&
    (seed.labelIds === undefined || seed.labelIds.length === 0)
  );
}

export function CreateIssueModal({
  open = true,
  onClose,
  seed,
  onFiling,
  onCreated,
}: CreateIssueModalProps) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const formId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const local = isBlankSeed(seed) ? readIssueComposerDraft() : null;
  /**
   * Whether this sitting owns the single local composer slot.
   *
   * There is one `polaris.draft.issue.<ws>` per workspace and it belongs to the blank
   * composer, which is the only one that reads it back. A seeded sitting — `/new?title=…`,
   * or a saved draft resumed from Drafts — used to write into it anyway and so destroyed the
   * half-typed issue somebody had walked away from, without ever having offered to restore
   * it. Captured once at mount because the seed cannot change under a sitting: the shell
   * gives each one its own key.
   */
  const ownsLocalSlot = useRef(isBlankSeed(seed));

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
          cyclesEnabled: team.cyclesEnabled,
          triageEnabled: team.triageEnabled,
          // The three settings `estimatesEnabled` and `estimateOptions` read. Carried on the
          // team row rather than fetched beside it, because the estimate pill exists or does
          // not exist according to the team the composer is currently pointed at.
          estimateScale: team.estimateScale,
          estimateAllowZero: team.estimateAllowZero,
          estimateExtended: team.estimateExtended,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );

  const people = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter((user) => user.status === 'active' && user.archivedAt === undefined)
        .map((user) => ({
          id: user.id,
          name: user.displayName,
          // Carried for the pill's avatar, which is the same glyph the detail rail draws.
          avatarUrl: user.avatarUrl ?? null,
        }))
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
  const [labelIds, setLabelIds] = useState<readonly UUID[]>(() => seed?.labelIds ?? []);
  const [estimate, setEstimate] = useState<number | undefined>(
    () => seed?.estimate ?? local?.estimate,
  );
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
  /**
   * The due date, and with a cadence set, the first due date of the series. One field for
   * both because they are the same day: a repeating issue's first due date *is* its due
   * date, and the create sends it as both.
   */
  const [dueDate, setDueDate] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  /** The "Create more" switch: file and stay, for a run of issues against the same properties. */
  const [createMore, setCreateMore] = useState(false);
  /** `V` opens the composer with the window; the expand button gets there from inside. */
  const [expanded, setExpanded] = useState(seed?.fullScreen === true);
  /** The overflow properties the filer has asked for this sitting. See `Extra`. */
  const [extras, setExtras] = useState<ReadonlySet<Extra>>(() => new Set());
  /**
   * A property just pulled out of the overflow, waiting for its pill to mount so its picker
   * can open from it. The menu is anchored to the pill, so the pill has to exist first.
   */
  const [pendingOpen, setPendingOpen] = useState<Extra | null>(null);
  /** How many issues this sitting of the dialog has filed. Only "Create more" moves it. */
  const [filed, setFiled] = useState(0);
  const submitted = useRef(false);
  /** A resumed saved draft is deleted by the first create, not by every one after it. */
  const draftCleared = useRef(false);
  /**
   * Whether a create is in the air, as a ref rather than as `saving`.
   *
   * `saving` is state, and state is a frame late: the click handler runs `save` synchronously
   * up to its `await`, so a second ⌘⏎ — or a click on "Create issue" in the same tick — would
   * find `saving` still false, pass the guard, and file a second issue with a second id.
   * Because `createIssue` is optimistic, both land in the list. The ref is written in the
   * same statement as the state and read by the guard, so the window a create is refused in
   * is the window the create is actually in.
   */
  const inFlight = useRef(false);

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
  const teamEstimates = team !== undefined && estimatesEnabled(team);
  const teamTimezone = team?.timezone ?? 'UTC';
  const fromTriage = fromTriagePath && team?.triageEnabled === true;

  const teamMenu = useMenuTrigger();
  const statusMenu = useMenuTrigger();
  const priorityMenu = useMenuTrigger();
  const assigneeMenu = useMenuTrigger();
  const estimateMenu = useMenuTrigger();
  const repeatMenu = useMenuTrigger();
  const moreMenu = useMenuTrigger();
  const templateMenu = useMenuTrigger();
  const formTemplateMenu = useMenuTrigger();
  const projectMenu = useMenuTrigger();
  const cycleMenu = useMenuTrigger();
  const labelMenu = useMenuTrigger();
  const dueMenu = useMenuTrigger('dialog');

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

  // Whether the team has anything to offer in each picker, which is what decides whether
  // the pill stands in the row; see `Extra`.
  const templatesOffered = useLiveQuery(
    (store) => teamId !== '' && templatesForTeam(store, teamId).length > 0,
    ['issueTemplate', 'team'],
    [teamId],
  );
  const formsOffered = useLiveQuery(
    (store) => teamId !== '' && formTemplatesForTeam(store, teamId).length > 0,
    ['formTemplate', 'team'],
    [teamId],
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
   * The chosen labels, resolved for the pill's chips and for the copied URL.
   *
   * The ids are the form's own state — nothing is filed yet, so there is no issue to read
   * them off — and this turns them back into the names and colours the chip draws. A label
   * deleted from another tab drops out of the list rather than rendering as a blank chip.
   */
  const chosenLabels = useLiveQuery(
    (store) =>
      labelIds.flatMap((id) => {
        const label = store.labels.get(id);
        if (label === undefined || label.archivedAt !== undefined) return [];
        return [{ id: label.id, name: label.name, color: label.color }];
      }),
    ['label'],
    [labelIds.join(',')],
  );

  const milestoneName = useLiveQuery(
    (store) =>
      seed?.projectMilestoneId === undefined
        ? null
        : (store.projectMilestones.get(seed.projectMilestoneId)?.name ?? null),
    ['projectMilestone'],
    [seed?.projectMilestoneId ?? ''],
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
              color: state.color,
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

  /**
   * The two chosen rows the property pills draw a glyph from. Both may be absent — a replica
   * still hydrating has no states, and nobody is a real answer for an assignee — and the pill
   * then shows the property's own glyph rather than a placeholder one.
   */
  const selectedState = states.find((state) => state.id === stateId);
  const selectedPerson = people.find((person) => person.id === assigneeId);

  /**
   * Pulls a property out of the overflow and opens its picker once the pill is on screen.
   *
   * Two renders on purpose: the pill has to exist before a menu can be anchored to it, so
   * the reveal is committed first and the effect below opens the picker on the render after.
   */
  const reveal = (extra: Extra) => {
    setExtras((current) => (current.has(extra) ? current : new Set([...current, extra])));
    setPendingOpen(extra);
  };

  useEffect(() => {
    if (pendingOpen === null) return;
    setPendingOpen(null);
    switch (pendingOpen) {
      case 'template':
        templateMenu.show();
        return;
      case 'form':
        formTemplateMenu.show();
        return;
      case 'repeat':
        repeatMenu.show();
        return;
      case 'due':
        dueMenu.show();
        return;
    }
  }, [pendingOpen, templateMenu, formTemplateMenu, repeatMenu, dueMenu]);

  /**
   * `Alt+C`: the composer with the template menu already up.
   *
   * Shown once and only once. Re-showing it whenever the flag is still on the seed would
   * reopen the menu the filer had just dismissed, on the next render that touched the team.
   */
  const offeredTemplates = useRef(false);
  useEffect(() => {
    if (offeredTemplates.current || !open || seed?.openTemplatePicker !== true || teamId === '') {
      return;
    }
    offeredTemplates.current = true;
    reveal('template');
  }, [open, seed?.openTemplatePicker, teamId]);

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

  /**
   * Puts what is on screen into the local slot.
   *
   * A function rather than only an effect body because the create path has to be able to put
   * it back: filing clears the slot before the round trip (see `save`), and a create that
   * comes back refused leaves a dialog full of words with nothing behind them.
   */
  const saveLocalSlot = useCallback(() => {
    if (!ownsLocalSlot.current) return;
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

  useEffect(() => {
    if (submitted.current || !open) return;
    saveLocalSlot();
  }, [open, saveLocalSlot]);

  const dirty = title.trim() !== '' || description.trim() !== '';

  /** Clearing the slot is as much an act of ownership as writing it. See `ownsLocalSlot`. */
  const clearLocalSlot = () => {
    if (ownsLocalSlot.current) writeIssueComposerDraft(null);
  };

  const leave = () => {
    submitted.current = true;
    setLeaving(false);
    onClose();
  };

  const requestClose = () => {
    if (leaving) return;
    if (!dirty) {
      clearLocalSlot();
      leave();
      return;
    }
    setLeaving(true);
    setDraftError(null);
  };

  const discardAndLeave = async () => {
    clearLocalSlot();
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
      clearLocalSlot();
      leave();
    } catch (failure) {
      setDraftBusy(false);
      setDraftError(
        failure instanceof ApiError ? failure.message : 'The draft could not be saved.',
      );
    }
  };

  /**
   * Copies a link that reopens this composer as it stands.
   *
   * Everything the composer can set goes on it — labels and the milestone included, which it
   * used to drop, so a URL copied from a labelled composer opened an unlabelled one. And the
   * write is awaited and answered: `navigator.clipboard` is absent on a non-secure origin and
   * the promise rejects when the page has lost focus, and both of those used to be a command
   * that ran, did nothing, and said nothing.
   */
  const copyCreateUrl = async () => {
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
      labels: chosenLabels.map((label) => label.name),
      project: projectName ?? undefined,
      milestone: milestoneName ?? undefined,
      template: templateName ?? undefined,
    });
    setCopied(null);
    setCopyError(null);
    try {
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) throw new Error('no clipboard');
      await clipboard.writeText(`${window.location.origin}${url}`);
      setCopied('Link copied');
    } catch {
      setCopyError('The link could not be copied. This browser only allows it over HTTPS.');
    }
  };

  /** The day a repeating issue is first due: what was typed, or today in the team's zone. */
  const resolvedDueDate = dueDate === '' ? today(teamTimezone) : dueDate;

  /**
   * Files the issue.
   *
   * `another` is "Create more": the issue goes, the dialog stays, and every property except
   * the words keeps its value. That is the whole point of it — somebody filing eight bugs
   * against the same team, project and cycle should set those once — so the reset below is
   * deliberately narrow: title, description and any form answers, and nothing else. It
   * defaults to the switch in the footer, so the primary button and ⌘⏎ honour it; ⌘⇧⏎ asks
   * for it outright.
   */
  const save = async ({ another = createMore }: { another?: boolean } = {}) => {
    if (inFlight.current) return;
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

    inFlight.current = true;
    setSaving(true);
    setTitleError(null);
    setSaveError(null);
    /*
      The words have left the composer, so the local slot lets go of them now rather than
      when the server answers.

      Both halves matter. The shell is told the sitting is spent, so `C` pressed while this
      create is in the air opens the next composer instead of being dropped — and that
      composer reads the local slot as it mounts, which is why the slot has to be empty
      before the round trip rather than after it. A refused create puts both back.
    */
    submitted.current = true;
    clearLocalSlot();
    onFiling?.(true);
    /*
      The template fills in what the filer left empty, and nothing else.

      Both keys used to be spread twice — the seed's, then the template's — so the later one
      won and `/new?estimate=XL&labels=bug` filed the template's points and labels instead,
      silently, on any team with a default template. An explicit ask beats a default; a
      default is only a default where nothing was asked.
    */
    const finalEstimate = estimate ?? template?.estimate;
    const finalLabelIds = labelIds.length > 0 ? labelIds : template?.labelIds;
    try {
      const createdId = await createIssue(engine, {
        teamId,
        title: resolvedTitle,
        description:
          formTemplate === null
            ? template === null
              ? description.trim()
              : unwrapPlaceholders(description.trim())
            : [
                unwrapPlaceholders(description.trim()),
                descriptionFromFormAnswers(formFields, formAnswers),
              ]
                .filter((part) => part !== '')
                .join('\n\n'),
        stateId: stateId === '' ? undefined : stateId,
        assigneeId: assigneeId === UNASSIGNED ? undefined : assigneeId,
        priority:
          formTemplate === null
            ? priority
            : priorityFromFormAnswers(formFields, formAnswers, priority),
        ...(finalEstimate === undefined ? null : { estimate: finalEstimate }),
        ...(finalLabelIds === undefined || finalLabelIds.length === 0
          ? null
          : { labelIds: [...finalLabelIds] }),
        ...(seed?.projectMilestoneId === undefined
          ? null
          : { projectMilestoneId: seed.projectMilestoneId }),
        // Carried on the create rather than written afterwards: a child that exists for a
        // moment without its parent is one the sub-issue panel would draw at top level.
        ...(seed?.parentId === undefined ? null : { parentId: seed.parentId }),
        ...(resolvedProjectId === null ? null : { projectId: resolvedProjectId }),
        ...(resolvedCycleId === null || !teamRunsCycles ? null : { cycleId: resolvedCycleId }),
        ...(fromTriage ? { fromTriage: true } : null),
        // The template's own contribution, carried on the create rather than applied
        // afterwards: a follow-up write for one filed issue would be a second version on the
        // stream and a frame in which the issue is not yet what the template says it is. Its
        // estimate and labels are folded into the two values above.
        ...(template === null ? null : { templateId: template.templateId }),
        ...(formTemplate === null ? null : { formTemplateId: formTemplate.id }),
        ...(templateIntent === 'cleared' ? { skipDefaultTemplate: true } : null),
        ...(cadence === null
          ? dueDate === ''
            ? null
            : { dueDate }
          : {
              recurringCadence: cadence,
              recurringFirstDueDate: resolvedDueDate,
              dueDate: resolvedDueDate,
            }),
        creatorId: viewerId ?? undefined,
      });
      clearLocalSlot();
      // After the await and before either exit, so it runs for "create more" as well as for
      // the close below — both are a filed issue, and only one of them unmounts anything.
      onCreated?.(createdId);
      if (seed?.draftId !== undefined && !draftCleared.current) {
        draftCleared.current = true;
        void deleteDraft(seed.draftId);
      }
      // "Create more": ⌘⇧⏎, the switch, or nothing else. `C` is not an alternative to it —
      // the keymap hands a bare letter to the title field the caret is sitting in, which is
      // what a text field is for.
      if (another) {
        inFlight.current = false;
        setSaving(false);
        // The dialog stays, so it goes back to being a composer: it owns the local slot
        // again and the shell may not replace it out from under a half-written second issue.
        submitted.current = false;
        onFiling?.(false);
        // Back to the template's own prompt rather than to blank, when there is one. A
        // template is one of the properties being kept, and keeping it while throwing away
        // the words it prefills would leave the second issue less templated than the first.
        setTitle(template?.title ?? '');
        setDescription(template?.description ?? '');
        setFormAnswers({});
        setFiled((count) => count + 1);
        titleRef.current?.focus();
        return;
      }
      inFlight.current = false;
      // Closed without waiting for anything else: the issue is already in the list, and the
      // outbox owns the rest of the story.
      onClose();
    } catch (failure) {
      inFlight.current = false;
      setSaving(false);
      // Refused: this is a composer again, holding the only copy of what was typed.
      submitted.current = false;
      saveLocalSlot();
      onFiling?.(false);
      setSaveError(
        failure instanceof ApiError ? failure.message : 'The issue could not be created.',
      );
    }
  };

  // Read through refs by the registered actions below. `useActions` forwards through the
  // latest render, so this is no longer what makes the chords correct; it stays because the
  // two submit paths differ only by an argument and read better side by side.
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = () => void save();
  const submitAnotherRef = useRef<() => void>(() => {});
  submitAnotherRef.current = () => void save({ another: true });
  const copyRef = useRef<() => void>(() => {});
  copyRef.current = () => void copyCreateUrl();

  // Everything the dialog covers belongs to the dialog: `J` must not scroll the list behind
  // it, and `C` must not open a second one. Sealing the context is not what does the second
  // one — a chain always ends at `global`, which is what keeps ⌘K and Escape working in here
  // — so `C` does reach the shell's `issue.create`, which drops the request rather than
  // throwing away a half-written issue. That is the right answer: the composer is already
  // open, and the way to file this one and start the next is ⌘⇧⏎.
  //
  // Both of these are gated on `open`, because the component now outlives the dialog. A shut
  // composer that still pushed `modal` would seal the keyboard over the whole app, and one
  // that still registered ⌘⏎ would collide with the next modal to claim it.
  useKeyContext('modal', open);

  /**
   * The property chords, the same letters the list and the detail view answer to. They only
   * fire with focus outside a text field — the keymap hands a bare letter to whichever field
   * holds the caret — so they are what Tab-then-`S` does, and what the filter rows teach.
   * Guarded on `leaving`: a picker opened behind the draft question would float over it.
   */
  const openPicker = (show: () => void, mounted: boolean) => {
    if (!leaving && mounted) show();
  };

  useActions(
    open
      ? [
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
            id: 'issue.submitNewAndAnother',
            title: 'Save new issue and start another',
            keys: ['mod+shift+Enter'],
            when: 'modal',
            group: 'Issues',
            // Hidden for the same reason as the one above: outside this dialog it is not a
            // command, it is a sentence about one.
            hidden: true,
            run: () => submitAnotherRef.current(),
          },
          {
            id: 'issue.copyComposerUrl',
            title: 'Copy pre-filled create URL',
            when: 'modal',
            group: 'Issues',
            run: () => copyRef.current(),
          },
          {
            id: 'composer.status',
            title: 'Change status',
            keys: ['s'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => openPicker(statusMenu.show, true),
          },
          {
            id: 'composer.priority',
            title: 'Set priority',
            keys: ['p'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => openPicker(priorityMenu.show, true),
          },
          {
            id: 'composer.assignee',
            title: 'Assign to',
            keys: ['a'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => openPicker(assigneeMenu.show, true),
          },
          {
            id: 'composer.labels',
            title: 'Add labels',
            keys: ['l'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => openPicker(labelMenu.show, teamId !== ''),
          },
          {
            id: 'composer.project',
            title: 'Add to project',
            keys: ['shift+p'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => openPicker(projectMenu.show, true),
          },
          {
            id: 'composer.cycle',
            title: 'Set cycle',
            keys: ['shift+c'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => openPicker(cycleMenu.show, teamRunsCycles),
          },
          {
            id: 'composer.estimate',
            title: 'Set estimate',
            keys: ['shift+e'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => openPicker(estimateMenu.show, teamEstimates),
          },
          {
            id: 'composer.dueDate',
            title: 'Set due date',
            keys: ['shift+d'],
            when: 'modal',
            group: 'Issues',
            hidden: true,
            run: () => {
              if (!leaving) {
                reveal('due');
                dueMenu.show();
              }
            },
          },
        ]
      : [],
    [open, dueMenu],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  // What stands in the row. A pill that holds a value is always shown, whatever the overflow
  // says: a property a link set must not be hidden from the person about to file it.
  const showTemplate = template !== null || templatesOffered || extras.has('template');
  const showForm = formTemplate !== null || formsOffered || extras.has('form');
  const showRepeat = cadence !== null || extras.has('repeat');
  const showDue = cadence !== null || dueDate !== '' || extras.has('due');

  const teamItems: MenuNode[] = teams.map((candidate) => ({
    id: candidate.id,
    label: candidate.name,
    text: `${candidate.key} ${candidate.name}`,
    icon: <TeamGlyph icon={candidate.icon} name={candidate.name} id={candidate.id} />,
    hint: candidate.key,
    selected: candidate.id === teamId,
    onSelect: () => {
      setChosenTeam(candidate.id);
      setChosenState(null);
      setCycleId(null);
      // The offering is team-scoped, so a template chosen for one team is not a template in
      // another. Back to `auto` rather than `cleared`: the new team's default is a different
      // template, and silently keeping "no template" across that change would skip a
      // default the filer never saw.
      setTemplateIntent('auto');
      setTemplate(null);
    },
  }));

  const statusItems: MenuNode[] = [];
  for (const [category, group] of groupByCategory(states)) {
    statusItems.push({ kind: 'heading', label: STATE_LABELS[category] });
    for (const state of group) {
      statusItems.push({
        id: state.id,
        label: state.name,
        icon: <StateIcon category={state.category} color={state.color} decorative />,
        selected: state.id === stateId,
        onSelect: () => setChosenState(state.id),
      });
    }
  }

  const priorityItems: MenuNode[] = PRIORITY_LEVELS.map((level) => ({
    id: `priority-${level}`,
    label: priorityLabel(level),
    icon: <PriorityIcon priority={level} decorative />,
    selected: level === priority,
    onSelect: () => setPriority(level),
  }));

  const assigneeItems: MenuNode[] = [
    {
      id: 'unassigned',
      label: 'No assignee',
      text: 'no assignee unassigned',
      icon: <PersonGlyph />,
      selected: assigneeId === UNASSIGNED,
      onSelect: () => setAssigneeId(UNASSIGNED),
    },
    { kind: 'separator' },
    ...people.map((person) => ({
      id: person.id,
      label: person.name,
      icon: (
        <Avatar
          name={person.name}
          src={person.avatarUrl}
          size="xs"
          colorKey={person.id}
          decorative
        />
      ),
      selected: person.id === assigneeId,
      onSelect: () => setAssigneeId(person.id),
    })),
  ];

  const estimateItems: MenuNode[] =
    team === undefined
      ? []
      : [
          {
            id: 'no-estimate',
            label: 'No estimate',
            text: 'no estimate none',
            selected: estimate === undefined,
            onSelect: () => setEstimate(undefined),
          },
          { kind: 'separator' },
          ...estimateOptions(team).map((value) => ({
            id: `estimate-${value}`,
            label: estimateLabel(value, team.estimateScale),
            selected: value === estimate,
            onSelect: () => setEstimate(value),
          })),
        ];

  const repeatItems: MenuNode[] = [
    {
      id: 'no-repeat',
      label: 'Does not repeat',
      text: 'does not repeat never none',
      selected: cadence === null,
      onSelect: () => setCadence(null),
    },
    { kind: 'separator' },
    ...CADENCES.map((option) => ({
      id: option,
      label: CADENCE_LABELS[option],
      selected: option === cadence,
      onSelect: () => {
        setCadence(option);
        if (dueDate === '') setDueDate(today(teamTimezone));
      },
    })),
  ];

  const moreItems: MenuNode[] = [
    ...(showDue
      ? []
      : [{ id: 'due', label: 'Due date', icon: <CalendarGlyph />, onSelect: () => reveal('due') }]),
    ...(showRepeat
      ? []
      : [
          {
            id: 'repeat',
            label: 'Repeat',
            icon: <RepeatGlyph />,
            onSelect: () => reveal('repeat'),
          },
        ]),
    ...(showTemplate
      ? []
      : [
          {
            id: 'template',
            label: 'Template',
            icon: <TemplateGlyph />,
            onSelect: () => reveal('template'),
          },
        ]),
    ...(showForm
      ? []
      : [{ id: 'form', label: 'Form', icon: <FormGlyph />, onSelect: () => reveal('form') }]),
  ];

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title="New issue"
        size="composer"
        // `V`, or the expand button: the same composer, given the window. A class rather than
        // a fifth `ModalSize`, because "as big as the screen" is this one dialog's answer to a
        // long description and not a width other dialogs should be able to ask for.
        className={expanded ? styles.fullScreen : undefined}
        initialFocus={titleRef}
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
              {team?.key ?? '—'}
            </PropertyPill>
            <span className={styles.crumb} aria-hidden="true">
              <ChevronGlyph />
            </span>
            <span className={styles.heading} aria-hidden="true">
              New issue
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
            {/*
              The link, where an attachment control would go. The composer cannot attach a
              file to an issue that does not exist yet, so the slot holds the one thing it can
              hand out before filing: a URL that reopens it as it stands.
            */}
            <IconButton
              variant="secondary"
              shape="round"
              aria-label="Copy link to this composer"
              icon={<LinkGlyph />}
              onClick={() => void copyCreateUrl()}
            />
            <div className={styles.footerActions}>
              <Switch label="Create more" checked={createMore} onChange={setCreateMore} />
              <Button form={formId} type="submit" variant="primary" loading={saving}>
                Create issue
              </Button>
            </div>
          </div>
        }
      >
        <form id={formId} className={styles.form} onSubmit={onSubmit}>
          <Input
            ref={titleRef}
            label="Title"
            hideLabel
            className={styles.title}
            surface="bare"
            value={title}
            error={titleError ?? undefined}
            placeholder="Issue title"
            autoComplete="off"
            onChange={(event) => {
              setTitle(event.target.value);
              if (titleError !== null) setTitleError(null);
            }}
            onKeyDown={
              /* keymap-lint-allow: intercepts Enter before the form's implicit submission,
                 which would otherwise file a half-written issue from the title field */
              (event) => {
                if (event.key !== 'Enter') return;
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                descriptionRef.current?.focus();
              }
            }
          />

          <Textarea
            ref={descriptionRef}
            label="Description"
            hideLabel
            className={styles.description}
            surface="bare"
            value={description}
            minRows={3}
            maxRows={12}
            placeholder={
              placeholderSpans(description).length > 0
                ? 'Type over the ⟦prompts⟧, then create'
                : 'Add description…'
            }
            onChange={(event) => setDescription(event.target.value)}
          />
          {template === null || template.subIssues.length === 0 ? null : (
            <p className={styles.dropped}>
              Also creates {template.subIssues.map((item) => item.title).join(', ')}.
            </p>
          )}

          {/*
            The properties. Each pill is named by its value and described by its property —
            "Backlog, button, Status" — because a row of values has to be scannable by eye and
            still say what each one is to somebody who cannot see the glyph. A pill with
            nothing in it shows the property's own name and says "No project", which is the
            value it holds.
          */}
          <div className={styles.properties}>
            <PropertyPill
              {...statusMenu.props}
              name="Status"
              describe={`${formId}-status`}
              icon={
                selectedState === undefined ? (
                  <StateIcon category="backlog" decorative />
                ) : (
                  <StateIcon
                    category={selectedState.category}
                    color={selectedState.color}
                    decorative
                  />
                )
              }
            >
              {selectedState?.name ?? 'Status'}
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
              {...assigneeMenu.props}
              name="Assignee"
              describe={`${formId}-assignee`}
              empty={selectedPerson === undefined ? 'No assignee' : undefined}
              icon={
                selectedPerson === undefined ? (
                  <PersonGlyph />
                ) : (
                  <Avatar
                    name={selectedPerson.name}
                    src={selectedPerson.avatarUrl}
                    size="xs"
                    colorKey={selectedPerson.id}
                    decorative
                  />
                )
              }
            >
              {selectedPerson?.name ?? 'Assignee'}
            </PropertyPill>

            <PropertyPill
              {...projectMenu.props}
              name="Project"
              describe={`${formId}-project`}
              empty={projectName === null ? 'No project' : undefined}
              icon={<ProjectGlyph />}
            >
              {projectName ?? 'Project'}
            </PropertyPill>

            {/*
              Only where the team estimates. `none` is not "unset", it is a team saying it
              does not size work, and a points pill on such a team is a control that can
              only produce a value nothing will ever read.
            */}
            {team !== undefined && teamEstimates ? (
              <PropertyPill
                {...estimateMenu.props}
                name="Estimate"
                describe={`${formId}-estimate`}
                empty={estimate === undefined ? 'No estimate' : undefined}
                icon={<EstimateGlyph />}
              >
                {estimate === undefined ? 'Estimate' : estimateLabel(estimate, team.estimateScale)}
              </PropertyPill>
            ) : null}

            <PropertyPill
              {...labelMenu.props}
              name="Labels"
              describe={`${formId}-labels`}
              empty={chosenLabels.length === 0 ? 'No labels' : undefined}
              icon={<TagGlyph />}
              disabled={teamId === ''}
            >
              {chosenLabels.length === 0
                ? 'Labels'
                : chosenLabels.map((label) => (
                    <LabelChip key={label.id} compact name={label.name} color={label.color} />
                  ))}
            </PropertyPill>

            {teamRunsCycles ? (
              <PropertyPill
                {...cycleMenu.props}
                name="Cycle"
                describe={`${formId}-cycle`}
                empty={cycleName === null ? 'No cycle' : undefined}
                icon={<CycleGlyph />}
              >
                {cycleName ?? 'Cycle'}
              </PropertyPill>
            ) : null}

            {showTemplate ? (
              <PropertyPill
                {...templateMenu.props}
                name="Template"
                describe={`${formId}-template`}
                empty={templateName === null ? 'No template' : undefined}
                icon={<TemplateGlyph />}
                disabled={teamId === ''}
              >
                {templateName ?? 'Template'}
              </PropertyPill>
            ) : null}

            {showForm ? (
              <PropertyPill
                {...formTemplateMenu.props}
                name="Form"
                describe={`${formId}-form-template`}
                empty={formTemplateName === null ? 'No form' : undefined}
                icon={<FormGlyph />}
                disabled={teamId === ''}
              >
                {formTemplateName ?? 'Form'}
              </PropertyPill>
            ) : null}

            {showRepeat ? (
              <PropertyPill
                {...repeatMenu.props}
                name="Repeat"
                describe={`${formId}-repeat`}
                empty={cadence === null ? 'Does not repeat' : undefined}
                icon={<RepeatGlyph />}
              >
                {cadence === null ? 'Repeat' : CADENCE_LABELS[cadence]}
              </PropertyPill>
            ) : null}

            {/*
              Same DueDatePicker the list and detail use — not a native date field. The
              platform calendar used to stand in here because the dialog already traps
              focus; the shared picker keeps relatives, SLA notes and the product's own
              date grammar in one place.
            */}
            {showDue ? (
              <>
                <PropertyPill
                  {...dueMenu.props}
                  name={cadence === null ? 'Due date' : 'First due'}
                  describe={`${formId}-due`}
                  empty={dueDate === '' ? 'No due date' : undefined}
                  icon={<CalendarGlyph />}
                >
                  {dueDate === '' ? (
                    cadence === null ? (
                      'Due date'
                    ) : (
                      'First due'
                    )
                  ) : (
                    <DueDateValue value={dueDate} timezone={teamTimezone} source="manual" />
                  )}
                </PropertyPill>
                <DueDatePicker
                  open={dueMenu.open}
                  onClose={dueMenu.hide}
                  trigger={dueMenu.ref}
                  value={dueDate === '' ? null : dueDate}
                  source="manual"
                  timezone={teamTimezone}
                  onSelect={(value) => setDueDate(value ?? '')}
                />
              </>
            ) : null}

            {milestoneName === null ? null : (
              <span className={styles.staticPill}>
                <span className={styles.pillGlyph} aria-hidden="true">
                  <MilestoneGlyph />
                </span>
                <span className={styles.srOnly}>Milestone: </span>
                {milestoneName}
              </span>
            )}

            {moreItems.length === 0 ? null : (
              <Button
                {...moreMenu.props}
                variant="pill"
                className={styles.glyphOnly}
                aria-label="More properties"
                icon={<MoreGlyph />}
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
          "Create more" leaves the dialog covering the list, so the only evidence that the
          last one went anywhere is this line. Announced, because the person who just pressed
          the chord is looking at a title field that emptied itself.
        */}
          {filed === 0 ? null : (
            <p className={styles.dropped} role="status">
              {filed === 1 ? 'Filed 1 issue. Keep going.' : `Filed ${filed} issues. Keep going.`}
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
          {/*
          The same courtesy for a link that named something this workspace does not have.
          A resolver that misses leaves an empty picker, which looks exactly like a picker
          nobody filled in — so the fields the URL asked for and did not get are named.
        */}
          {seed?.unresolved === undefined || seed.unresolved.length === 0 ? null : (
            <p className={styles.dropped} role="status">
              {`This link asked for ${listOf(seed.unresolved)}, which is not in this workspace.`}
            </p>
          )}
          {copied === null ? null : (
            <p className={styles.dropped} role="status">
              {copied}
            </p>
          )}
          {copyError === null ? null : (
            <p className={styles.error} role="alert">
              {copyError}
            </p>
          )}
        </form>

        <Menu
          open={teamMenu.open}
          onClose={teamMenu.hide}
          trigger={teamMenu.ref}
          items={teamItems}
          label="Team"
          filterable
          filterPlaceholder="Change team…"
          emptyLabel="No team by that name"
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
          emptyLabel={states.length === 0 ? 'This team has no statuses' : 'No status matches'}
        />
        <Menu
          open={priorityMenu.open}
          onClose={priorityMenu.hide}
          trigger={priorityMenu.ref}
          items={priorityItems}
          label="Priority"
          filterable
          filterPlaceholder="Set priority…"
          filterHint="p"
          emptyLabel="No priority matches"
        />
        <Menu
          open={assigneeMenu.open}
          onClose={assigneeMenu.hide}
          trigger={assigneeMenu.ref}
          items={assigneeItems}
          label="Assignee"
          filterable
          filterPlaceholder="Assign to…"
          filterHint="a"
          emptyLabel="Nobody by that name"
        />
        <Menu
          open={estimateMenu.open}
          onClose={estimateMenu.hide}
          trigger={estimateMenu.ref}
          items={estimateItems}
          label="Estimate"
          filterable
          filterPlaceholder="Set estimate…"
          filterHint="shift+e"
          emptyLabel="No estimate matches"
        />
        <Menu
          open={repeatMenu.open}
          onClose={repeatMenu.hide}
          trigger={repeatMenu.ref}
          items={repeatItems}
          label="Repeat"
        />
        <Menu
          open={moreMenu.open}
          onClose={moreMenu.hide}
          trigger={moreMenu.ref}
          items={moreItems}
          label="More properties"
        />
        <ProjectPicker
          open={projectMenu.open}
          onClose={projectMenu.hide}
          trigger={projectMenu.ref}
          filterHint="shift+p"
          teamIds={teamId === '' ? [] : [teamId]}
          value={resolvedProjectId}
          onSelect={setProjectId}
        />
        <CyclePicker
          open={cycleMenu.open}
          onClose={cycleMenu.hide}
          trigger={cycleMenu.ref}
          filterHint="shift+c"
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
        <LabelPicker
          open={labelMenu.open}
          onClose={labelMenu.hide}
          trigger={labelMenu.ref}
          filterHint="l"
          teamId={teamId === '' ? null : teamId}
          value={labelIds}
          onApply={(labelId, displaced) =>
            setLabelIds((current) => [
              ...current.filter((id) => id !== labelId && !displaced.includes(id)),
              labelId,
            ])
          }
          onRemove={(labelId) => setLabelIds((current) => current.filter((id) => id !== labelId))}
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
              {/* The way out of the question, so it is the ghost. Discard is destructive and
                  says so; saving is what the dialog is asking for. */}
              <Button variant="ghost" onClick={() => setLeaving(false)}>
                Keep editing
              </Button>
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

function LinkGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7M9.5 6.5a2.5 2.5 0 0 0-3.54 0L3.84 8.62a2.5 2.5 0 0 0 3.54 3.54l.7-.7"
        {...STROKE}
      />
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

function ProjectGlyph() {
  return (
    <Glyph>
      <path d="M8 1.75 13.5 5v6L8 14.25 2.5 11V5z" {...STROKE} />
      <path d="M8 8v6.25M8 8 2.5 5M8 8l5.5-3" {...STROKE} />
    </Glyph>
  );
}

function EstimateGlyph() {
  return (
    <Glyph>
      <path d="M3 13V8m5 5V3m5 10v-3" {...STROKE} strokeWidth={2} />
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

function CycleGlyph() {
  return (
    <Glyph>
      <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" {...STROKE} />
      <path d="M8 .75 10 2.5 8 4.25" {...STROKE} />
      <path d="M8 5.25V8l2 1.5" {...STROKE} />
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

function FormGlyph() {
  return (
    <Glyph>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" {...STROKE} />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" {...STROKE} />
    </Glyph>
  );
}

function RepeatGlyph() {
  return (
    <Glyph>
      <path
        d="M2.5 6.5V6a2 2 0 0 1 2-2h8M11 1.5 13.5 4 11 6.5M13.5 9.5v.5a2 2 0 0 1-2 2h-8M5 14.5 2.5 12 5 9.5"
        {...STROKE}
      />
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

function MilestoneGlyph() {
  return (
    <Glyph>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8z" {...STROKE} />
    </Glyph>
  );
}

function MoreGlyph() {
  return (
    <Glyph>
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
    </Glyph>
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
