import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { TemplatePicker } from '~/features/templates/TemplatePicker';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import {
  Store,
  type Change,
  type Entity,
  type EntityType,
  type IssueTemplate,
  type Label,
  type OptimisticPatch,
  type Team,
  type TemplateProperties,
  type User,
  type UUID,
  type WorkflowState,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Templates } from './Templates';

/**
 * Templates are a replicated entity, so these run against a real `Store` with no database
 * and no server behind it. Mocking the store would mean asserting that a screen asked a mock
 * a question — which stays green through exactly the changes that break it, a renamed index
 * or a scope rule that stops being applied.
 *
 * The engine stub does one thing the plain `vi.fn()` does not: it applies the optimistic
 * patch. That is not a convenience, it is the single behaviour of `SyncEngine.mutate` this
 * whole screen is built on — the row is in the list on the frame the button is pressed and
 * the network happens afterwards — and a stub that swallowed the patch would let every
 * assertion below pass against a screen that never showed the user anything.
 */

const WORKSPACE = 'workspace-1';
const ENG = 'team-eng';
const OPS = 'team-ops';
const ADA = 'user-ada';
const AT = '2026-01-01T00:00:00Z';

/** The id the fake server mints for a created template; never one the client chose. */
const MINTED = 'template-from-server';

function team(id: UUID, key: string, name: string, over: Partial<Team> = {}): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function person(id: UUID, displayName: string): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name: displayName,
    displayName,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(
  id: UUID,
  teamId: UUID,
  name: string,
  category: WorkflowState['category'],
  position: string,
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: category === 'backlog',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function label(id: UUID, name: string, over: Partial<Label> = {}): Label {
  return {
    id,
    workspaceId: WORKSPACE,
    isGroup: false,
    name,
    color: '#6b7280',
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function template(id: UUID, name: string, over: Partial<IssueTemplate> = {}): IssueTemplate {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    title: '',
    body: '',
    properties: {},
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/** A replica holding exactly these rows, in this order, with the versions a stream would use. */
function storeWith(rows: readonly [EntityType, Entity][]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

interface MutateInput {
  readonly mutation: string;
  readonly variables: Record<string, unknown>;
  readonly optimistic?: OptimisticPatch;
}

/**
 * The server, as far as this screen can tell.
 *
 * Matched on the operation name rather than by call order, so a screen that legitimately
 * sends two writes in one interaction is not held to a sequence it never promised. Create is
 * the only one whose response is read — the client has no id of its own to keep, so the row
 * it renders after the reply is the server's.
 */
function answer(mutation: string, variables: Record<string, unknown>): unknown {
  if (mutation.includes('mutation CreateIssueTemplate')) {
    const input = variables.input as Record<string, unknown>;
    return {
      createIssueTemplate: {
        version: 2,
        template: {
          ...template(MINTED, String(input.name), {
            ...(input.teamId === undefined ? null : { teamId: input.teamId as UUID }),
            ...(input.description === undefined
              ? null
              : { description: String(input.description) }),
            title: input.title === undefined ? '' : String(input.title),
            body: input.body === undefined ? '' : String(input.body),
            properties: (input.properties ?? {}) as TemplateProperties,
            position: 'z',
            createdBy: ADA,
          }),
        },
      },
    };
  }
  return {};
}

function engineFor(store: Store) {
  const mutate = vi.fn(async (input: MutateInput) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return answer(input.mutation, input.variables);
  });
  return { mutate, engine: { store, mutate } as unknown as SyncEngine };
}

function mount(store: Store, children: ReactNode) {
  const { mutate, engine } = engineFor(store);
  render(
    <MemoryRouter initialEntries={['/settings/templates']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          {children}
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate, user: userEvent.setup() };
}

function renderScreen(store: Store) {
  return mount(store, <Templates />);
}

/** The variables of the one call that carried the named operation. */
function sent(mutate: ReturnType<typeof engineFor>['mutate'], operation: string) {
  const call = mutate.mock.calls.find(([input]) => input.mutation.includes(operation));
  return call?.[0];
}

/** A scope's section, found by the heading that names it. */
function section(name: RegExp): HTMLElement {
  return screen.getByRole('region', { name });
}

/** A trigger and the template picker it opens, wired the way the create dialog wires them. */
function PickerHarness({
  teamId,
  onSelect,
}: {
  teamId: UUID;
  onSelect: (chosen: IssueTemplate | null) => void;
}) {
  const trigger = useMenuTrigger();
  return (
    <>
      <button {...trigger.props}>Choose template</button>
      <TemplatePicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        teamId={teamId}
        value={null}
        onSelect={onSelect}
      />
    </>
  );
}

const TEAMS: [EntityType, Entity][] = [
  ['team', team(ENG, 'ENG', 'Engineering')],
  ['team', team(OPS, 'OPS', 'Operations')],
  ['user', person(ADA, 'Ada Lovelace')],
];

/**
 * The settings screen: scope, and the two things about it that are irreversible.
 *
 * Only a rendered screen can prove either of them. That a template is created in the scope
 * whose button was pressed is a claim about which of three "New template" buttons was
 * clicked, and the mutation wrapper cannot see a button. That the permanence of the choice is
 * stated *while the choice is live* is a claim about what is on screen at a particular
 * moment, which no test of the write can make at all.
 */
describe('Templates', () => {
  it('groups templates by scope, workspace first, and lists each only where it is offered', () => {
    renderScreen(
      storeWith([
        ...TEAMS,
        ['issueTemplate', template('t-any', 'Anything', { position: 'V' })],
        ['issueTemplate', template('t-eng', 'Bug report', { teamId: ENG, position: 'W' })],
      ]),
    );

    // Workspace first: it is the scope that reaches every team, and reading down the page is
    // then reading from the widest reach to the narrowest.
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['WorkspaceEvery team', 'Engineering', 'Operations', 'Archived']);

    expect(within(section(/^Workspace/)).getByText('Anything')).toBeTruthy();
    expect(within(section(/^Workspace/)).queryByText('Bug report')).toBeNull();
    expect(within(section(/^Engineering/)).getByText('Bug report')).toBeTruthy();
    // Not merely absent from Operations' list: a template belonging to another team is not a
    // thing Operations can be shown at all.
    expect(within(section(/^Operations/)).queryByText('Bug report')).toBeNull();
  });

  it('says the scope cannot be changed, while the choice is still live', async () => {
    const { user } = renderScreen(
      storeWith([...TEAMS, ['issueTemplate', template('t-eng', 'Bug report', { teamId: ENG })]]),
    );

    await user.click(screen.getByRole('button', { name: 'New template for Engineering' }));
    const creating = screen.getByRole('form', { name: 'New template for Engineering' });
    expect(creating.textContent).toContain('offered only in Engineering');
    expect(creating.textContent).toContain('fixed when it is created');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit Bug report' }));

    const editing = screen.getByRole('form', { name: 'Editing Bug report' });
    // Stated as a fact rather than offered as a disabled control: `UpdateIssueTemplateInput`
    // has no teamId, so there is nothing here that could ever be enabled.
    expect(editing.textContent).toContain('cannot be changed');
    expect(within(editing).queryByRole('combobox', { name: /scope|team/i })).toBeNull();
  });

  it('creates in the scope whose button was pressed, and sends exactly what the API takes', async () => {
    const { mutate, user } = renderScreen(
      storeWith([
        ...TEAMS,
        ['workflowState', state('s-todo', ENG, 'Todo', 'unstarted', 'V')],
        ['label', label('l-urgent', 'urgent')],
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'New template for Engineering' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Bug report');
    await user.type(
      screen.getByRole('textbox', { name: 'What it is for' }),
      'Anything reproducible',
    );
    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Bug: ');
    await user.type(screen.getByRole('textbox', { name: 'Issue description' }), 'Steps:');

    await user.click(screen.getByRole('button', { name: 'Status: No status' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Todo' }));
    await user.click(screen.getByRole('checkbox', { name: 'urgent' }));

    await user.click(screen.getByRole('button', { name: 'Create template' }));

    await waitFor(() => expect(sent(mutate, 'mutation CreateIssueTemplate')).toBeTruthy());
    const call = sent(mutate, 'mutation CreateIssueTemplate');
    expect(call?.variables).toEqual({
      input: {
        teamId: ENG,
        name: 'Bug report',
        description: 'Anything reproducible',
        title: 'Bug: ',
        body: 'Steps:',
        // Written whole, because the server replaces the stored JSON rather than merging
        // into it. Priority is absent because zero is the absence of a priority.
        properties: { stateId: 's-todo', labelIds: ['l-urgent'] },
      },
    });

    // Optimistic: a patch went with the write, inserting a row that was not there before.
    const patch = call?.optimistic ?? [];
    expect(patch).toHaveLength(1);
    expect(patch[0]?.type).toBe('issueTemplate');
    expect(patch[0]?.before).toBeNull();

    // And the screen shows it, under the scope it was created in, with what it prefills
    // spelled out rather than counted.
    const row = within(section(/^Engineering/)).getByText('Bug report');
    expect(row).toBeTruthy();
    expect(within(section(/^Engineering/)).getByText(/Status: Todo/)).toBeTruthy();
    expect(within(section(/^Engineering/)).getByText(/urgent/)).toBeTruthy();
  });

  it('sends only what an edit changed, so a rename does not rewrite the properties', async () => {
    const { mutate, user } = renderScreen(
      storeWith([
        ...TEAMS,
        ['workflowState', state('s-todo', ENG, 'Todo', 'unstarted', 'V')],
        [
          'issueTemplate',
          template('t-eng', 'Bug report', {
            teamId: ENG,
            description: 'Anything reproducible',
            title: 'Bug: ',
            properties: { stateId: 's-todo', priority: 1 },
          }),
        ],
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'Edit Bug report' }));
    const nameField = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(nameField);
    await user.type(nameField, 'Defect report');
    await user.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(sent(mutate, 'mutation UpdateIssueTemplate')).toBeTruthy());
    // `properties` is absent, and that is the whole point of comparing before sending: the
    // server replaces the stored JSON rather than merging into it, so a rename that carried
    // the properties along would rewrite them on every save.
    expect(sent(mutate, 'mutation UpdateIssueTemplate')?.variables).toEqual({
      input: { id: 't-eng', name: 'Defect report' },
    });
    expect(await screen.findByText('Defect report')).toBeTruthy();
    // The editor closed, and the row it edited is back — with what it still prefills intact.
    expect(screen.getByText(/Status: Todo/)).toBeTruthy();
  });

  it('leaves the draft on screen, beside the server’s own words, when a write is refused', async () => {
    const { mutate, user } = renderScreen(storeWith(TEAMS));
    mutate.mockRejectedValueOnce(new ApiError('CONFLICT', 'a template called that already exists'));

    await user.click(screen.getByRole('button', { name: 'New template for Engineering' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Bug report');
    await user.click(screen.getByRole('button', { name: 'Create template' }));

    // The server's sentence rather than an invented one: a duplicate name is something the
    // person at the keyboard can act on, and only the server knows which name collided.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('a template called that already exists');
    // And the editor stays, with the typing still in it. A settings page that closed the form
    // and put a banner at the top would have thrown away the only copy of what was refused.
    expect(screen.getByRole('form', { name: 'New template for Engineering' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Bug report',
    );
  });

  it('asks before archiving, says what cannot be undone, and sends nothing until it is answered', async () => {
    const { mutate, user } = renderScreen(
      storeWith([...TEAMS, ['issueTemplate', template('t-eng', 'Bug report', { teamId: ENG })]]),
    );

    await user.click(screen.getByRole('button', { name: 'Archive Bug report' }));

    const dialog = screen.getByRole('dialog', { name: 'Archive Bug report?' });
    // Not "are you sure": there is no un-archive mutation and no query on this side that can
    // show an archived template again, and the sentence has to say so before the button does.
    expect(dialog.textContent).toContain('There is no way back');
    expect(dialog.textContent).toContain('Issues already filed from it keep their link');
    expect(mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Archive it' }));

    await waitFor(() => expect(sent(mutate, 'mutation ArchiveIssueTemplate')).toBeTruthy());
    expect(sent(mutate, 'mutation ArchiveIssueTemplate')?.variables).toEqual({ id: 't-eng' });
    // The patch is a delete rather than a flag, because a delete is what the sync stream
    // carries for a retired template.
    expect(sent(mutate, 'mutation ArchiveIssueTemplate')?.optimistic?.[0]?.after).toBeNull();
    await waitFor(() => expect(screen.queryByText('Bug report')).toBeNull());
  });

  it('accounts for the archive it cannot show', () => {
    renderScreen(storeWith(TEAMS));

    const archived = section(/^Archived/);
    expect(archived.textContent).toContain('there is no un-archive');
    // The absence is explained rather than left as an empty box: an archived template leaves
    // every replica, so there is nothing here to restore from and saying so is the only
    // honest thing this section can do.
    expect(archived.textContent).toContain('leaves every replica');
  });
});

/**
 * What a scope is allowed to prefill — the part of this feature that is not obvious.
 *
 * Only the editor can prove these. A property is an id and an id has a scope: a workflow
 * status belongs to exactly one team, so there is no status that a template offered in every
 * team could name. `templateDefaults` drops such a property when an issue is filed, but by
 * then somebody has already written a template that does not do what it says. This is the
 * half that stops it being written, and it is invisible to every other kind of test — a
 * control that is not rendered has no unit to test.
 */
describe('Templates · what each scope may prefill', () => {
  const WITH_STATUSES: [EntityType, Entity][] = [
    ...TEAMS,
    ['workflowState', state('s-eng-todo', ENG, 'Todo', 'unstarted', 'V')],
    ['workflowState', state('s-eng-doing', ENG, 'In Progress', 'started', 'V')],
    ['workflowState', state('s-ops-todo', OPS, 'Queued', 'unstarted', 'V')],
  ];

  it('offers a workspace template no status at all, and says why instead', async () => {
    const { user } = renderScreen(storeWith(WITH_STATUSES));

    await user.click(screen.getByRole('button', { name: 'New template for Workspace' }));
    const form = screen.getByRole('form', { name: 'New template for Workspace' });

    // No control, not a disabled one: a disabled control says "not yet", and a status every
    // team has is not a thing that arrives later.
    expect(within(form).queryByRole('button', { name: /^Status/ })).toBeNull();
    expect(within(form).queryByRole('combobox', { name: 'Status' })).toBeNull();
    expect(form.textContent).toContain('A status belongs to one team');
    expect(screen.queryAllByRole('menuitem')).toEqual([]);
  });

  it("offers a team template that team's statuses and nobody else's", async () => {
    const { user } = renderScreen(storeWith(WITH_STATUSES));

    await user.click(screen.getByRole('button', { name: 'New template for Engineering' }));
    await user.click(screen.getByRole('button', { name: 'Status: No status' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Todo',
      'In Progress',
    ]);
    expect(screen.queryByRole('menuitem', { name: 'Queued' })).toBeNull();
  });

  it('offers a workspace template only the workspace’s labels, and a team template both', async () => {
    const rows: [EntityType, Entity][] = [
      ...TEAMS,
      ['label', label('l-urgent', 'urgent')],
      ['label', label('l-backend', 'backend', { teamId: ENG })],
      ['label', label('l-oncall', 'oncall', { teamId: OPS })],
    ];
    const { user } = renderScreen(storeWith(rows));

    await user.click(screen.getByRole('button', { name: 'New template for Workspace' }));
    expect(screen.getByRole('checkbox', { name: 'urgent' })).toBeTruthy();
    // A team's label may only go on that team's issues, so a template offered in every team
    // could never apply it.
    expect(screen.queryByRole('checkbox', { name: 'backend' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'New template for Engineering' }));

    expect(screen.getByRole('checkbox', { name: 'urgent' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'backend' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'oncall' })).toBeNull();
  });

  it('replaces a group-mate rather than writing a template the database would refuse', async () => {
    const rows: [EntityType, Entity][] = [
      ...TEAMS,
      ['label', label('l-group', 'Priority', { isGroup: true })],
      ['label', label('l-p0', 'P0', { parentId: 'l-group' })],
      ['label', label('l-p1', 'P1', { parentId: 'l-group' })],
    ];
    const { mutate, user } = renderScreen(storeWith(rows));

    await user.click(screen.getByRole('button', { name: 'New template for Workspace' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Escalation');
    await user.click(screen.getByRole('checkbox', { name: 'P0' }));
    await user.click(screen.getByRole('checkbox', { name: 'P1' }));

    // At most one label from a group may sit on an issue. A template carrying both would have
    // its second application refused halfway through filing an issue, about a template the
    // person filing it did not write.
    expect((screen.getByRole('checkbox', { name: 'P0' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'P1' }) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Create template' }));
    await waitFor(() => expect(sent(mutate, 'mutation CreateIssueTemplate')).toBeTruthy());
    expect(
      (sent(mutate, 'mutation CreateIssueTemplate')?.variables.input as Record<string, unknown>)
        .properties,
    ).toEqual({ labelIds: ['l-p1'] });
  });

  it('offers no estimate where nothing estimates, and the union of the ladders where something does', async () => {
    const { user } = renderScreen(storeWith(TEAMS));
    await user.click(screen.getByRole('button', { name: 'New template for Workspace' }));
    expect(screen.getByRole('form', { name: 'New template for Workspace' }).textContent).toContain(
      'No team in this workspace estimates',
    );
    expect(screen.queryByRole('combobox', { name: 'Estimate' })).toBeNull();

    // A second workspace, on its own replica: the interesting case needs teams that estimate,
    // and the uninteresting one needs teams that do not, so neither can be reached from the
    // other without editing team settings this screen does not own.
    cleanup();
    const second = renderScreen(
      storeWith([
        ['team', team(ENG, 'ENG', 'Engineering', { estimateScale: 'fibonacci' })],
        ['team', team(OPS, 'OPS', 'Operations', { estimateScale: 'linear' })],
      ]),
    );
    await second.user.click(screen.getByRole('button', { name: 'New template for Workspace' }));

    const estimate = screen.getByRole('combobox', { name: 'Estimate' });
    // The union of fibonacci and linear: every value offered is one some team's scale names,
    // and a team reading 3 as its own third rung is what the scale is for.
    expect([...estimate.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'No estimate',
      '1',
      '2',
      '3',
      '4',
      '5',
      '8',
    ]);
  });

  it('says so when a team has estimates turned off', async () => {
    const { user } = renderScreen(
      storeWith([
        ['team', team(ENG, 'ENG', 'Engineering')],
        ['team', team(OPS, 'OPS', 'Operations', { estimateScale: 'fibonacci' })],
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'New template for Engineering' }));
    expect(
      screen.getByRole('form', { name: 'New template for Engineering' }).textContent,
    ).toContain('This team does not estimate');
  });
});

/**
 * The picker, which is the only thing the person filing an issue ever sees of this feature.
 *
 * Its rules are the mirror image of the editor's, and they have to be tested separately
 * because they answer a different question. The editor asks what a template *may say*; the
 * picker asks who is *offered* it — and the answer to the second is decided by the team the
 * issue is being filed in, not by the team the template was written for.
 */
describe('TemplatePicker', () => {
  const rows: [EntityType, Entity][] = [
    ...TEAMS,
    ['issueTemplate', template('t-any', 'Anything', { description: 'A blank start' })],
    ['issueTemplate', template('t-eng', 'Bug report', { teamId: ENG, position: 'W' })],
    ['issueTemplate', template('t-ops', 'Incident', { teamId: OPS, position: 'X' })],
  ];

  /**
   * One team's offering, on a replica of its own.
   *
   * The teardown is explicit because the claim below is about two teams and therefore needs
   * two renders inside one test: auto-cleanup runs between tests, not between renders, and
   * the second picker would otherwise be asked about a menu the first one had already opened.
   */
  async function offered(teamId: UUID) {
    cleanup();
    const chosen = vi.fn();
    const { user } = mount(storeWith(rows), <PickerHarness teamId={teamId} onSelect={chosen} />);
    await user.click(screen.getByRole('button', { name: 'Choose template' }));
    return { chosen, user, items: screen.getAllByRole('menuitem').map((item) => item.textContent) };
  }

  it('offers a workspace template in every team and a team’s template only in its own', async () => {
    const eng = await offered(ENG);
    expect(eng.items).toEqual([
      'No template',
      // A row's anatomy: the name, the description trailing it on the same line, and the
      // scope in the trailing slot — which every workspace template carries, so that the
      // marker is something a reader learns rather than something that comes and goes.
      'Anything — A blank startEvery team',
      'Bug report',
    ]);

    const ops = await offered(OPS);
    // Not merely last: another team's template is not shown at all. Its status and its labels
    // belong to that team, so filing an issue from it here would be refused, and a rule the
    // user never meets is better than an error message.
    expect(ops.items).toEqual(['No template', 'Anything — A blank startEvery team', 'Incident']);
  });

  it('makes "no template" a choice rather than the absence of one', async () => {
    const { chosen, user } = await offered(ENG);

    await user.click(screen.getByRole('menuitem', { name: 'No template' }));

    // A picker whose only way back to a blank form is Escape has made a template a trap: the
    // title and body have already landed in the fields, and undoing that has to be an item in
    // the same list that caused it.
    expect(chosen).toHaveBeenCalledWith(null);
  });

  it('does not offer an archived template', async () => {
    const chosen = vi.fn();
    const { user } = mount(
      storeWith([
        ...TEAMS,
        ['issueTemplate', template('t-old', 'Retired', { teamId: ENG, archivedAt: AT })],
        ['issueTemplate', template('t-any', 'Anything')],
      ]),
      <PickerHarness teamId={ENG} onSelect={chosen} />,
    );
    await user.click(screen.getByRole('button', { name: 'Choose template' }));

    // Filtered here as well as by the server. The server emits a *delete* when a template is
    // retired, so in practice the row has already left the replica — but a bootstrap that has
    // not caught up, or a snapshot restored from IndexedDB, can still be holding one, and
    // filing from it is a write the server would refuse.
    expect(screen.queryByRole('menuitem', { name: /^Retired/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^Anything/ })).toBeTruthy();
  });

  it('offers nothing at all in a team the replica does not have', async () => {
    const chosen = vi.fn();
    const { user } = mount(
      storeWith([...TEAMS, ['issueTemplate', template('t-any', 'Anything')]]),
      // What the create dialog passes while a workspace with no teams hydrates, and what it
      // is left holding when the team it was opened on is retired.
      <PickerHarness teamId="" onSelect={chosen} />,
    );
    await user.click(screen.getByRole('button', { name: 'Choose template' }));

    // Not even the workspace's, which is offered in every team that exists: filing into a
    // team the server does not have would be refused on the issue the user was writing.
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'No template',
    ]);
  });
});

/**
 * The join between the settings screen and the create dialog.
 *
 * Neither of the two describes above can prove this one. The settings screen knows a row left
 * its own list; the picker knows what its own query returns; and the claim that matters —
 * that retiring a template on one screen stops it being offered on the other, at once, with
 * no round trip in between — is a claim about the store they share.
 */
describe('Templates and the create dialog', () => {
  it('takes an archived template out of the picker on the frame it is archived', async () => {
    const store = storeWith([
      ...TEAMS,
      ['issueTemplate', template('t-eng', 'Bug report', { teamId: ENG })],
    ]);
    const chosen = vi.fn();
    const { user } = mount(
      store,
      <>
        <Templates />
        <PickerHarness teamId={ENG} onSelect={chosen} />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Choose template' }));
    expect(screen.getByRole('menuitem', { name: 'Bug report' })).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Archive Bug report' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive it' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Choose template' }));

    // Gone from the offering, leaving the one item that is never a template. No round trip
    // was involved: the optimistic patch deleted the row, which is what the sync stream
    // carries for a retired template anyway.
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'No template',
    ]);
  });
});
