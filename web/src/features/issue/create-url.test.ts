import { describe, expect, it } from 'vitest';

import { Store, type Change, type Entity } from '~/store';

import {
  buildCreateURL,
  parseCreateURL,
  parseEstimate,
  parsePriority,
  resolveCreateURL,
} from './create-url';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const ENG = '01900000-0000-7000-8000-000000000002';
const DES = '01900000-0000-7000-8000-000000000003';
const ENG_TODO = '01900000-0000-7000-8000-000000000004';
const ENG_DOING = '01900000-0000-7000-8000-000000000005';
const DES_DOING = '01900000-0000-7000-8000-000000000006';

const AT = '2026-01-01T00:00:00.000Z';

function team(id: string, key: string, name: string): Entity {
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
  } as Entity;
}

function state(id: string, teamId: string, name: string, isDefault: boolean): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    name,
    category: isDefault ? 'unstarted' : 'started',
    position: 'V',
    isDefault,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

/** Two teams, so "which team does a teamless URL mean" is a question with a wrong answer. */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    ['team', team(ENG, 'ENG', 'Engineering')],
    ['team', team(DES, 'DES', 'Design')],
    ['workflowState', state(ENG_TODO, ENG, 'Todo', true)],
    ['workflowState', state(ENG_DOING, ENG, 'In Progress', false)],
    ['workflowState', state(DES_DOING, DES, 'In Progress', false)],
  ];
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

describe('parseCreateURL', () => {
  it('reads the documented keys, including the singular label alias', () => {
    const params = parseCreateURL(
      new URLSearchParams(
        'title=Fix+the+flake&description=it+flakes&priority=Urgent&assignee=me&label=bug,infra',
      ),
      'ENG',
    );
    expect(params).toEqual({
      title: 'Fix the flake',
      description: 'it flakes',
      team: 'ENG',
      priority: 'Urgent',
      assignee: 'me',
      labels: 'bug,infra',
    });
  });

  it('lets an explicit team query override the path', () => {
    const params = parseCreateURL(new URLSearchParams('team=DES'), 'ENG');
    expect(params.team).toBe('DES');
  });

  it('drops blank values so a bookmark of empty params is an empty composer', () => {
    const params = parseCreateURL(new URLSearchParams('title=&priority='));
    expect(params).toEqual({});
  });

  it('accepts projectMilestone as the documented alias of milestone', () => {
    const params = parseCreateURL(new URLSearchParams('milestone=Beta'));
    expect(params.milestone).toBe('Beta');
    const aliased = parseCreateURL(new URLSearchParams('projectMilestone=Beta'));
    expect(aliased.milestone).toBe('Beta');
  });
});

describe('parsePriority', () => {
  it('accepts the product words and the numeric scale', () => {
    expect(parsePriority('Urgent')).toBe(1);
    expect(parsePriority('high')).toBe(2);
    expect(parsePriority('3')).toBe(3);
    expect(parsePriority('nope')).toBe(0);
  });
});

describe('parseEstimate', () => {
  it('maps T-shirt sizes onto the Fibonacci points the docs name', () => {
    expect(parseEstimate('XS')).toBe(1);
    expect(parseEstimate('M')).toBe(3);
    expect(parseEstimate('XXL')).toBe(13);
    expect(parseEstimate('8')).toBe(8);
    expect(parseEstimate('nope')).toBeUndefined();
  });
});

describe('buildCreateURL', () => {
  it('omits empty fields so a copy of a blank composer is just /new', () => {
    expect(buildCreateURL({})).toBe('/new');
  });

  it('puts the team in the path and the rest on the query', () => {
    expect(
      buildCreateURL({
        teamKey: 'ENG',
        title: 'Fix the flake',
        priority: 1,
      }),
    ).toBe('/team/ENG/new?title=Fix+the+flake&priority=Urgent');
  });
});

describe('resolveCreateURL', () => {
  it('resolves a status against the team the URL names', () => {
    const seed = resolveCreateURL(
      seeded(),
      parseCreateURL(new URLSearchParams('status=In+Progress'), 'ENG'),
      null,
    );
    expect(seed.teamId).toBe(ENG);
    expect(seed.stateId).toBe(ENG_DOING);
  });

  /**
   * `/new?status=Todo` names no team, and the composer it opens does: it lands on the
   * workspace's first team by key. Resolving the status against nothing instead dropped a
   * documented parameter with no error and no empty field to notice — the issue was simply
   * filed in the default status.
   */
  it('resolves a status with no team against the team the composer will choose', () => {
    const seed = resolveCreateURL(
      seeded(),
      parseCreateURL(new URLSearchParams('status=In+Progress')),
      null,
    );
    expect(seed.teamId).toBeUndefined();
    // DES sorts before ENG, and the composer's own fallback picks the same one.
    expect(seed.stateId).toBe(DES_DOING);
  });

  it('still drops a status no team has', () => {
    const seed = resolveCreateURL(
      seeded(),
      parseCreateURL(new URLSearchParams('status=Nope')),
      null,
    );
    expect(seed.stateId).toBeUndefined();
  });

  /**
   * Finding 65: every resolver drops what it cannot find, which is right — a stale status
   * name should still file the issue. What it must not do is drop it silently: an empty
   * picker looks exactly like a picker nobody filled in, so `?status=Tood` opened a composer
   * that looked correct and filed with the team default.
   */
  it('names the values it could not resolve', () => {
    const seed = resolveCreateURL(
      seeded(),
      parseCreateURL(new URLSearchParams('status=Tood&assignee=nobody@example.com'), 'ENG'),
      null,
    );

    expect(seed.stateId).toBeUndefined();
    expect(seed.unresolved).toEqual([
      'status \u201cTood\u201d',
      'assignee \u201cnobody@example.com\u201d',
    ]);
  });

  it('says nothing when everything resolved', () => {
    const seed = resolveCreateURL(
      seeded(),
      parseCreateURL(new URLSearchParams('status=In+Progress'), 'ENG'),
      null,
    );

    expect(seed.unresolved).toBeUndefined();
  });
});

describe('buildCreateURL', () => {
  /**
   * Finding 66: the composer's "copy create URL" produced a link that reopened it without
   * the labels or the milestone it was carrying, so the copy was quietly lossier than the
   * thing it copied.
   */
  it('carries labels and the milestone', () => {
    expect(
      buildCreateURL({
        teamKey: 'ENG',
        title: 'Fix the flake',
        labels: ['Bug', 'Chore'],
        milestone: 'Beta',
      }),
    ).toBe('/team/ENG/new?title=Fix+the+flake&labels=Bug%2CChore&milestone=Beta');
  });
});
