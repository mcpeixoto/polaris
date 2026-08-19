import { describe, expect, it } from 'vitest';

import type { Store, UUID } from '~/store';

import { withAutoAssignOnStart } from './auto-assign';

function storeOf(issueAssignee: UUID | undefined, category: string): Store {
  return {
    issues: { get: () => ({ assigneeId: issueAssignee }) },
    workflowStates: { get: () => ({ category }) },
  } as unknown as Store;
}

describe('withAutoAssignOnStart', () => {
  it('assigns the viewer when moving an unassigned issue into started', () => {
    const fields = withAutoAssignOnStart(
      storeOf(undefined, 'started'),
      'issue-1',
      { stateId: 's1', assigneeId: undefined as string | undefined },
      'me',
      { autoAssignOnStart: true },
    );
    expect(fields.assigneeId).toBe('me');
  });

  it('leaves an already-assigned issue alone', () => {
    const fields = withAutoAssignOnStart(
      storeOf('ada', 'started'),
      'issue-1',
      { stateId: 's1', assigneeId: undefined as string | undefined },
      'me',
      { autoAssignOnStart: true },
    );
    expect(fields.assigneeId).toBeUndefined();
  });

  it('does nothing when the preference is off', () => {
    const fields = withAutoAssignOnStart(
      storeOf(undefined, 'started'),
      'issue-1',
      { stateId: 's1', assigneeId: undefined as string | undefined },
      'me',
      { autoAssignOnStart: false },
    );
    expect(fields.assigneeId).toBeUndefined();
  });
});
