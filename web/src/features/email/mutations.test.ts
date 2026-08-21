import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Store, type IssueTemplate, type Team } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { updateIssueTemplateEmailIntake, updateTeamEmailIntake } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TEMPLATE = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

let mutate: ReturnType<typeof vi.fn>;
let engine: SyncEngine;

beforeEach(() => {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'team',
      id: TEAM,
      op: 'upsert',
      actor: { type: 'system' },
      payload: team(),
    },
  ]);
  mutate = vi.fn(async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {
      updateTeamEmailIntake: {
        team: { ...team(), emailIntakeEnabled: true, emailIntakeAddress: 'abc@inbound.example' },
      },
    };
  });
  engine = { store, mutate } as unknown as SyncEngine;
});

describe('updateTeamEmailIntake', () => {
  it('patches the flag and keeps the server-minted address', async () => {
    await updateTeamEmailIntake(engine, TEAM, true);

    const next = engine.store.get('team', TEAM);
    expect(next?.emailIntakeEnabled).toBe(true);
    expect(next?.emailIntakeAddress).toBe('abc@inbound.example');
    expect(mutate.mock.calls[0]?.[0].variables.input).toEqual({ teamId: TEAM, enabled: true });
  });
});

describe('updateIssueTemplateEmailIntake', () => {
  it('patches a team template without inventing an address', async () => {
    const store = engine.store;
    store.applyChanges([
      {
        v: 2,
        type: 'issueTemplate',
        id: TEMPLATE,
        op: 'upsert',
        actor: { type: 'system' },
        payload: issueTemplate(),
      },
    ]);
    mutate.mockImplementation(
      async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
        if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
        return {
          updateIssueTemplateEmailIntake: {
            template: {
              ...issueTemplate(),
              emailIntakeEnabled: true,
              emailIntakeAddress: 'tpl@inbound.example',
            },
          },
        };
      },
    );

    await updateIssueTemplateEmailIntake(engine, TEMPLATE, true);

    const next = engine.store.get('issueTemplate', TEMPLATE);
    expect(next?.emailIntakeEnabled).toBe(true);
    expect(next?.emailIntakeAddress).toBe('tpl@inbound.example');
    expect(mutate.mock.calls.at(-1)?.[0].variables.input).toEqual({
      templateId: TEMPLATE,
      enabled: true,
    });
  });
});

function team(): Team {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issueTemplate(): IssueTemplate {
  return {
    id: TEMPLATE,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: 'Bug',
    title: '',
    body: '',
    properties: {},
    subIssues: [],
    position: 'a0',
    createdAt: AT,
    updatedAt: AT,
  };
}
