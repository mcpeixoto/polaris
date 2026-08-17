import { describe, expect, it } from 'vitest';

import {
  fold,
  IssueIndex,
  LabelIndex,
  NotificationIndex,
  RelationIndex,
  SetIndex,
} from './indexes';
import type { Issue, IssueLabel, IssueRelation, Notification, RelationType, UUID } from './types';

const NOW = '2026-01-01T00:00:00Z';

function issue(id: UUID, over: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Fix the login redirect',
    description: '',
    stateId: 's1',
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function issueLabel(id: UUID, issueId: UUID, labelId: UUID): IssueLabel {
  return { id, workspaceId: 'w', issueId, labelId, teamId: 't1', createdAt: NOW };
}

function relation(
  id: UUID,
  issueId: UUID,
  relatedIssueId: UUID,
  type: RelationType = 'blocks',
): IssueRelation {
  return {
    id,
    workspaceId: 'w',
    issueId,
    relatedIssueId,
    type,
    teamId: 't1',
    relatedTeamId: 't1',
    createdAt: NOW,
  };
}

function notification(id: UUID, over: Partial<Notification> = {}): Notification {
  return {
    id,
    workspaceId: 'w',
    userId: 'u1',
    type: 'issue_assigned',
    issueId: 'i1',
    actor: { type: 'user', id: 'u2' },
    changeVersion: 1,
    groupKey: `assign:${id}`,
    count: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('SetIndex', () => {
  it('drops a bucket when it empties, so a long session does not leak empty sets', () => {
    const index = new SetIndex<string>();
    index.add('a', 'x');
    index.add('a', 'y');
    index.remove('a', 'x');
    expect([...index.keys()]).toEqual(['a']);
    index.remove('a', 'y');
    expect([...index.keys()]).toEqual([]);
    expect(index.get('a').size).toBe(0);
  });
});

describe('fold', () => {
  it('strips diacritics and case so a search matches what the user meant', () => {
    expect(fold('Résumé  the  Sprint ')).toBe('resume the sprint');
  });
});

describe('IssueIndex', () => {
  it('files an issue under every dimension', () => {
    const index = new IssueIndex();
    index.add(issue('i1', { teamId: 't1', stateId: 's1', assigneeId: 'u1', priority: 2 }));

    expect([...index.byTeam('t1')]).toEqual(['i1']);
    expect([...index.byState('s1')]).toEqual(['i1']);
    expect([...index.byAssignee('u1')]).toEqual(['i1']);
    expect([...index.byPriority(2)]).toEqual(['i1']);
    expect([...index.active()]).toEqual(['i1']);
    expect(index.size).toBe(1);
  });

  it('files an unassigned issue in its own bucket rather than under a sentinel id', () => {
    const index = new IssueIndex();
    index.add(issue('i1'));
    expect([...index.byAssignee(null)]).toEqual(['i1']);
    expect(index.byAssignee('u1').size).toBe(0);
  });

  it('keeps archived issues out of the default corpus but inside the full one', () => {
    const index = new IssueIndex();
    index.add(issue('i1', { archivedAt: NOW }));
    expect(index.active().size).toBe(0);
    expect([...index.all()]).toEqual(['i1']);
  });

  it('moves an issue between buckets on update, leaving nothing behind', () => {
    const index = new IssueIndex();
    const before = issue('i1', { stateId: 's1', assigneeId: 'u1', priority: 1, teamId: 't1' });
    index.add(before);

    const after = issue('i1', { stateId: 's2', assigneeId: 'u2', priority: 3, teamId: 't2' });
    index.update(before, after);

    for (const [label, set] of [
      ['old state', index.byState('s1')],
      ['old assignee', index.byAssignee('u1')],
      ['old priority', index.byPriority(1)],
      ['old team', index.byTeam('t1')],
    ] as const) {
      if (set.has('i1')) {
        throw new Error(`an updated issue must not remain in its ${label} bucket`);
      }
    }
    expect([...index.byState('s2')]).toEqual(['i1']);
    expect([...index.byAssignee('u2')]).toEqual(['i1']);
    expect([...index.byPriority(3)]).toEqual(['i1']);
    expect([...index.byTeam('t2')]).toEqual(['i1']);
  });

  it('re-indexes the title only when the title changed', () => {
    const index = new IssueIndex();
    const before = issue('i1', { title: 'Fix the login redirect' });
    index.add(before);

    const renamed = issue('i1', { title: 'Fix the logout redirect' });
    index.update(before, renamed);

    expect(index.search('login').size).toBe(0);
    expect([...index.search('logout')]).toEqual(['i1']);
  });

  it('removes an issue from every dimension', () => {
    const index = new IssueIndex();
    const entity = issue('i1', { assigneeId: 'u1', priority: 2 });
    index.add(entity);
    index.remove(entity);

    expect(index.size).toBe(0);
    expect(index.all().size).toBe(0);
    expect(index.active().size).toBe(0);
    expect(index.byTeam('t1').size).toBe(0);
    expect(index.byState('s1').size).toBe(0);
    expect(index.byAssignee('u1').size).toBe(0);
    expect(index.byPriority(2).size).toBe(0);
    expect(index.search('login').size).toBe(0);
    expect(index.updatedOrder()).toEqual([]);
  });

  it('rebuilds identically to the same sequence of incremental writes', () => {
    const issues = [
      issue('i1', {
        title: 'Alpha',
        assigneeId: 'u1',
        priority: 1,
        updatedAt: '2026-01-03T00:00:00Z',
      }),
      issue('i2', { title: 'Beta', priority: 2, updatedAt: '2026-01-01T00:00:00Z' }),
      issue('i3', {
        title: 'Gamma',
        assigneeId: 'u1',
        priority: 1,
        updatedAt: '2026-01-02T00:00:00Z',
      }),
    ];

    const incremental = new IssueIndex();
    for (const entity of issues) incremental.add(entity);

    const rebuilt = new IssueIndex();
    rebuilt.rebuild(issues);

    expect(rebuilt.updatedOrder()).toEqual(incremental.updatedOrder());
    expect([...rebuilt.byAssignee('u1')].sort()).toEqual([...incremental.byAssignee('u1')].sort());
    expect([...rebuilt.search('gamma')]).toEqual([...incremental.search('gamma')]);
  });

  it('orders by parsed time, because trimmed RFC 3339 fractions do not compare as strings', () => {
    const index = new IssueIndex();
    // Go emits RFC3339Nano with trailing zeros trimmed, so ".5" and ".55" would compare
    // as "5Z" against "55Z" and put the earlier instant first.
    index.add(issue('later', { updatedAt: '2026-01-01T00:00:00.55Z' }));
    index.add(issue('earlier', { updatedAt: '2026-01-01T00:00:00.5Z' }));

    if (index.updatedOrder()[0] !== 'later') {
      throw new Error(
        'the most recently updated issue must sort first; comparing RFC 3339 strings gets this backwards',
      );
    }
  });

  it('re-sorts the shared order once after a batch rather than once per change', () => {
    const index = new IssueIndex();
    for (let i = 0; i < 5; i++) {
      index.add(issue(`i${i}`, { updatedAt: `2026-01-0${i + 1}T00:00:00Z` }));
    }
    const first = index.updatedOrder();
    // Nothing changed, so the array is the same one: views comparing results by identity
    // must not see a new array for a batch that touched nothing.
    expect(index.updatedOrder()).toBe(first);
    expect(first).toEqual(['i4', 'i3', 'i2', 'i1', 'i0']);
  });

  it('finds by substring, accent- and case-insensitively', () => {
    const index = new IssueIndex();
    index.add(issue('i1', { title: 'Résumé the paused sprint' }));
    index.add(issue('i2', { title: 'Unrelated work' }));

    expect([...index.search('resume')]).toEqual(['i1']);
    expect([...index.search('RESUME THE')]).toEqual(['i1']);
    expect(index.search('nothing here').size).toBe(0);
  });

  it('confirms trigram hits with a substring check', () => {
    const index = new IssueIndex();
    // Shares every trigram of "abcd" without containing it.
    index.add(issue('decoy', { title: 'abcxxbcd' }));
    index.add(issue('real', { title: 'abcd' }));

    if (index.search('abcd').has('decoy')) {
      throw new Error(
        'trigram containment is a superset test; an unconfirmed hit shows a result that does not match and reads as a broken search',
      );
    }
    expect([...index.search('abcd')]).toEqual(['real']);
  });

  it('answers queries shorter than a trigram by scanning the folded titles', () => {
    const index = new IssueIndex();
    index.add(issue('i1', { title: 'Onboarding' }));
    index.add(issue('i2', { title: 'Billing' }));

    expect([...index.search('on')]).toEqual(['i1']);
    expect([...index.search('')].sort()).toEqual(['i1', 'i2']);
  });

  it('treats an upsert for a known issue as an update rather than a double add', () => {
    const index = new IssueIndex();
    const entity = issue('i1', { assigneeId: 'u1' });
    index.add(entity);
    index.add(entity);
    expect(index.size).toBe(1);
    expect([...index.byAssignee('u1')]).toEqual(['i1']);
  });

  it('files a sub-issue under its parent and a parentless one under none', () => {
    const index = new IssueIndex();
    index.add(issue('parent'));
    index.add(issue('child', { parentId: 'parent' }));

    expect([...index.byParent('parent')]).toEqual(['child']);
    expect([...index.byParent(null)]).toEqual(['parent']);
  });

  it('moves a re-parented issue, leaving nothing under the old parent', () => {
    const index = new IssueIndex();
    const before = issue('child', { parentId: 'p1' });
    index.add(before);
    index.update(before, issue('child', { parentId: 'p2' }));

    if (index.byParent('p1').has('child')) {
      throw new Error(
        "a re-parented issue left behind under its old parent is counted twice in the parent's rollup",
      );
    }
    expect([...index.byParent('p2')]).toEqual(['child']);

    const promoted = issue('child', { parentId: 'p2' });
    index.update(promoted, issue('child'));
    expect(index.byParent('p2').size).toBe(0);
    expect([...index.byParent(null)]).toEqual(['child']);
  });

  it('drops a removed sub-issue from its parent', () => {
    const index = new IssueIndex();
    const child = issue('child', { parentId: 'parent' });
    index.add(child);
    index.remove(child);
    expect(index.byParent('parent').size).toBe(0);
  });
});

describe('LabelIndex', () => {
  it('answers in both directions from one row', () => {
    const index = new LabelIndex();
    index.add(issueLabel('il1', 'i1', 'bug'));

    expect([...index.labelIdsFor('i1')]).toEqual(['bug']);
    expect([...index.issueIdsWith('bug')]).toEqual(['i1']);
    expect([...index.rowIdsForIssue('i1')]).toEqual(['il1']);
    expect([...index.rowIdsForLabel('bug')]).toEqual(['il1']);
  });

  it('keeps the other applications when one is removed', () => {
    const index = new LabelIndex();
    const bug = issueLabel('il1', 'i1', 'bug');
    index.add(bug);
    index.add(issueLabel('il2', 'i1', 'regression'));
    index.add(issueLabel('il3', 'i2', 'bug'));

    index.remove(bug);

    // Removing one label must not disturb the issue's other labels, nor the same label on
    // another issue: that is the whole reason an application is a row.
    expect([...index.labelIdsFor('i1')]).toEqual(['regression']);
    expect([...index.issueIdsWith('bug')]).toEqual(['i2']);
  });

  it('leaves no stale posting when a row moves to another label', () => {
    const index = new LabelIndex();
    const before = issueLabel('il1', 'i1', 'bug');
    index.add(before);
    index.update(before, issueLabel('il1', 'i1', 'regression'));

    for (const [where, present] of [
      ['label of issue', index.labelIdsFor('i1').has('bug')],
      ['issues with label', index.issueIdsWith('bug').has('i1')],
      ['rows of label', index.rowIdsForLabel('bug').has('il1')],
    ] as const) {
      if (present) {
        throw new Error(
          `an updated application must leave nothing under its old label, and it is still in the ${where}; the issue keeps matching a filter for a label it no longer carries`,
        );
      }
    }
    expect([...index.labelIdsFor('i1')]).toEqual(['regression']);
    expect([...index.rowIdsForIssue('i1')]).toEqual(['il1']);
  });

  it('is idempotent for a replayed add', () => {
    const index = new LabelIndex();
    const row = issueLabel('il1', 'i1', 'bug');
    index.add(row);
    index.add(row);
    expect([...index.labelIdsFor('i1')]).toEqual(['bug']);
    expect([...index.rowIdsForIssue('i1')]).toEqual(['il1']);
  });

  it('rebuilds identically to the same sequence of incremental writes', () => {
    const rows = [
      issueLabel('il1', 'i1', 'bug'),
      issueLabel('il2', 'i1', 'regression'),
      issueLabel('il3', 'i2', 'bug'),
    ];
    const incremental = new LabelIndex();
    for (const row of rows) incremental.add(row);
    const rebuilt = new LabelIndex();
    rebuilt.rebuild(rows);

    expect([...rebuilt.labelIdsFor('i1')].sort()).toEqual(
      [...incremental.labelIdsFor('i1')].sort(),
    );
    expect([...rebuilt.issueIdsWith('bug')].sort()).toEqual(
      [...incremental.issueIdsWith('bug')].sort(),
    );
  });
});

describe('RelationIndex', () => {
  it('indexes a relation from both ends, because the inverse is a read and not a row', () => {
    const index = new RelationIndex();
    index.add(relation('r1', 'i1', 'i2'));

    expect([...index.rowIdsFrom('i1')]).toEqual(['r1']);
    expect([...index.rowIdsTo('i2')]).toEqual(['r1']);
    expect(index.rowIdsTo('i1').size).toBe(0);
  });

  it('removes from both ends, leaving no half-visible link', () => {
    const index = new RelationIndex();
    const row = relation('r1', 'i1', 'i2', 'related');
    index.add(row);
    index.remove(row);
    expect(index.rowIdsFrom('i1').size).toBe(0);
    expect(index.rowIdsTo('i2').size).toBe(0);
  });

  it('keeps the blocks rows as issue ids for the filter compiler', () => {
    const index = new RelationIndex();
    index.add(relation('r1', 'i1', 'i2'));
    index.add(relation('r2', 'i1', 'i3', 'related'));

    expect([...(index.blockingByIssue().get('i1') ?? [])]).toEqual(['i2']);
    expect([...(index.blockedByIssue().get('i2') ?? [])]).toEqual(['i1']);
    // `related` is not blocking, and a filter for "blocked" must not match on it.
    expect(index.blockedByIssue().get('i3')).toBeUndefined();
  });

  it('drops a link out of the blocking buckets when it is retyped', () => {
    const index = new RelationIndex();
    const before = relation('r1', 'i1', 'i2');
    index.add(before);
    index.update(before, relation('r1', 'i1', 'i2', 'related'));

    if (index.blockedByIssue().get('i2')?.has('i1') === true) {
      throw new Error(
        'a link retyped away from blocks must leave the blocking buckets, or the issue stays blocked by something that no longer blocks it',
      );
    }
    expect([...index.rowIdsFrom('i1')]).toEqual(['r1']);
  });

  it('leaves no stale end when a relation is repointed', () => {
    const index = new RelationIndex();
    const before = relation('r1', 'i1', 'i2');
    index.add(before);
    index.update(before, relation('r1', 'i1', 'i3'));

    if (index.rowIdsTo('i2').has('r1')) {
      throw new Error(
        'a repointed relation left behind on its old target shows a blocker that cannot be cleared from either side',
      );
    }
    expect([...index.rowIdsTo('i3')]).toEqual(['r1']);
  });
});

describe('NotificationIndex', () => {
  it('holds a new row unread and lets it go when it is read', () => {
    const index = new NotificationIndex();
    const unread = notification('n1');
    index.add(unread);
    expect([...index.unread()]).toEqual(['n1']);

    index.update(unread, notification('n1', { readAt: NOW }));
    if (index.unread().has('n1')) {
      throw new Error('a read notification left in the unread set is a badge that never clears');
    }
  });

  it('files a row under the issue it concerns, and drops it on removal', () => {
    const index = new NotificationIndex();
    const row = notification('n1', { issueId: 'i1' });
    index.add(row);
    expect([...index.rowIdsForIssue('i1')]).toEqual(['n1']);

    index.remove(row);
    expect(index.rowIdsForIssue('i1').size).toBe(0);
    expect(index.unread().size).toBe(0);
  });

  it('moves a row that changes issue rather than leaving it under both', () => {
    const index = new NotificationIndex();
    const before = notification('n1', { issueId: 'i1' });
    index.add(before);
    index.update(before, notification('n1', { issueId: 'i2' }));

    expect(index.rowIdsForIssue('i1').size).toBe(0);
    expect([...index.rowIdsForIssue('i2')]).toEqual(['n1']);
  });

  it('keeps a row with no issue out of the issue buckets entirely', () => {
    const index = new NotificationIndex();
    index.add(notification('n1', { issueId: undefined }));
    expect([...index.unread()]).toEqual(['n1']);
    expect(index.rowIdsForIssue('i1').size).toBe(0);
  });
});
