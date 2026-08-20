import { describe, expect, it } from 'vitest';

import { inheritsCycleSchedule } from './inherit';

describe('inheritsCycleSchedule', () => {
  it('locks a nested team when the parent runs cycles', () => {
    expect(inheritsCycleSchedule({ parentTeamId: 'parent' }, { cyclesEnabled: true })).toBe(true);
  });

  it('leaves a nested team free when the parent has no schedule', () => {
    expect(inheritsCycleSchedule({ parentTeamId: 'parent' }, { cyclesEnabled: false })).toBe(false);
  });

  it('leaves a top-level team free', () => {
    expect(inheritsCycleSchedule({}, { cyclesEnabled: true })).toBe(false);
    expect(inheritsCycleSchedule({}, null)).toBe(false);
  });
});
