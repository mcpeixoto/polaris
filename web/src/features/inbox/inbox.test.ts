import { describe, expect, it } from 'vitest';

import { describeEvent } from './inbox';

describe('describeEvent', () => {
  it('says a deadline is today or overdue from the sweep payload', () => {
    expect(describeEvent('issue_due', 'ENG-12', { kind: 'today' })).toBe('ENG-12 is due today');
    expect(describeEvent('issue_due', 'ENG-4', { kind: 'overdue' })).toBe('ENG-4 is overdue');
  });

  it('does not invent a day for a due row that has no kind', () => {
    expect(describeEvent('issue_due', 'ENG-12')).toBe('ENG-12 is due');
    expect(describeEvent('issue_due', 'ENG-12', {})).toBe('ENG-12 is due');
  });
});
