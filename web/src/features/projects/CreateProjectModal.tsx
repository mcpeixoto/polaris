/**
 * Create a project. Name and at least one team; everything else can wait.
 *
 * Mounted from the projects list and from the command menu. Compact on purpose: a project
 * is a name and a team, and a form that asks for a timeframe, a lead and a colour before
 * the first issue is filed is the form-builder look this product is not allowed to ship.
 *
 * It reads top to bottom the way the create-issue composer does: the document first — a
 * name and a summary, unboxed, because they are prose and not form values — then the
 * properties, in a labelled grid. Team and template used to be unlabelled controls sitting
 * under two unlabelled text fields, which made four fields in a row that named none of
 * themselves; the two that are properties now say what they are.
 */

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Modal, Select } from '~/components';
import { projectTemplatesForTeam } from '~/features/project-templates/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { createProject } from './mutations';
import styles from './CreateProjectModal.module.css';

const NO_TEMPLATE = '';

export interface CreateProjectModalProps {
  onClose: () => void;
}

export function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewerId = useViewerId();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .map((team) => ({ id: team.id, key: team.key, name: team.name }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );

  const fromPath = useTeamKeyInPath();
  const [chosenTeam, setChosenTeam] = useState<UUID | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const teamId = useMemo(() => {
    if (chosenTeam !== null && teams.some((team) => team.id === chosenTeam)) return chosenTeam;
    return teams.find((team) => team.key === fromPath)?.id ?? teams[0]?.id ?? '';
  }, [chosenTeam, teams, fromPath]);

  const templates = useLiveQuery(
    (store) => (teamId === '' ? [] : projectTemplatesForTeam(store, teamId)),
    ['projectTemplate', 'team'],
    [teamId],
  );

  const onTemplateChange = (nextId: string) => {
    setTemplateId(nextId);
    if (nextId === NO_TEMPLATE) return;
    const template = templates.find((candidate) => candidate.id === nextId);
    if (template === undefined) return;
    setName(template.name);
    setSummary(template.summary);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A project needs a name');
      nameRef.current?.focus();
      return;
    }
    if (teamId === '') {
      setSaveError('A project needs a team');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const id = await createProject(engine, {
        name: trimmed,
        summary: summary.trim() === '' ? undefined : summary.trim(),
        teamIds: [teamId],
        leadId: viewerId ?? undefined,
        ...(templateId === NO_TEMPLATE ? null : { projectTemplateId: templateId }),
      });
      onClose();
      if (id !== '') void navigate(`/project/${id}`);
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof ApiError ? error.message : 'Could not create the project');
    }
  };

  // Read through a ref by the registered action below. `useActions` forwards through the
  // latest render, so calling `save` directly would work too — this stays as the shape
  // project-create.spec.ts describes, and costs nothing.
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = () => void save();

  useKeyContext('modal');
  useActions(
    [
      {
        id: 'project.create.submit',
        title: 'Create project',
        keys: ['mod+Enter'],
        when: 'modal',
        group: 'Projects',
        hidden: true,
        run: () => submitRef.current(),
      },
    ],
    [],
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="New project"
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Create project
          </Button>
        </>
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
          surface="plain"
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
          surface="plain"
          value={summary}
          placeholder="What does done look like?"
          autoComplete="off"
          onChange={(event) => setSummary(event.target.value)}
        />
        <div className={styles.properties}>
          <Select
            label="Team"
            value={teamId}
            onChange={(event) => {
              setChosenTeam(event.target.value);
              setTemplateId(NO_TEMPLATE);
            }}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.key} · {team.name}
              </option>
            ))}
          </Select>
          {templates.length === 0 ? null : (
            <Select
              label="Template"
              value={templateId}
              onChange={(event) => onTemplateChange(event.target.value)}
            >
              <option value={NO_TEMPLATE}>No template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          )}
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
