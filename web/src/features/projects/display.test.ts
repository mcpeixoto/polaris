import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_DISPLAY,
  parseProjectDisplayParams,
  resolveProjectDisplay,
  toProjectDisplayParams,
} from './display';

describe('project display URL', () => {
  it('round-trips non-default options', () => {
    const display = {
      layout: 'timeline' as const,
      zoom: 'quarter' as const,
      showDependencies: false,
      showMilestones: false,
    };
    const params = new URLSearchParams(toProjectDisplayParams(display));
    expect(parseProjectDisplayParams(params)).toEqual(display);
    expect(resolveProjectDisplay(params)).toEqual(display);
  });

  it('omits defaults from the URL', () => {
    expect(toProjectDisplayParams(DEFAULT_PROJECT_DISPLAY)).toEqual({});
  });

  it('ignores unknown layout values', () => {
    const params = new URLSearchParams({ layout: 'gantt', zoom: 'eon' });
    expect(parseProjectDisplayParams(params)).toEqual({});
  });
});
