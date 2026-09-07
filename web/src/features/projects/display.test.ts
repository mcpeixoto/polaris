import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_DISPLAY,
  parseProjectDisplayParams,
  projectOrderingNote,
  resolveProjectDisplay,
  toProjectDisplayParams,
} from './display';

describe('project display URL', () => {
  it('round-trips non-default options', () => {
    const display = {
      layout: 'board' as const,
      grouping: 'lead' as const,
      ordering: 'targetDate' as const,
      direction: 'desc' as const,
      columns: ['priority', 'lead', 'status'] as const,
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

  it('ignores unknown grouping, ordering and direction values', () => {
    const params = new URLSearchParams({ group: 'phase', order: 'vibes', dir: 'sideways' });
    expect(parseProjectDisplayParams(params)).toEqual({});
  });

  // A column set is a choice, and "none of them" is one of the choices. Dropped rather than
  // read as absent, a name-only table would silently come back with all six columns.
  it('carries an empty column set through the URL, and drops names it does not know', () => {
    expect(toProjectDisplayParams({ columns: [] })).toEqual({ cols: '' });
    expect(resolveProjectDisplay(new URLSearchParams({ cols: '' })).columns).toEqual([]);
    expect(resolveProjectDisplay(new URLSearchParams({ cols: 'lead,mood' })).columns).toEqual([
      'lead',
    ]);
  });

  // The menu cannot produce a column order other than the canonical one, and a hand-edited
  // link that does must not pin a `cols=` parameter into every link shared from that page.
  it('reads columns in the canonical order however the URL spells them', () => {
    const display = resolveProjectDisplay(new URLSearchParams({ cols: 'status,health' }));
    expect(display.columns).toEqual(['health', 'status']);
  });

  it('says when an ordering has nothing to decide under a grouping', () => {
    expect(projectOrderingNote('manual', 'priority')).toBeNull();
    expect(projectOrderingNote('manual', 'none')).toBeNull();
    expect(projectOrderingNote('manual', 'lead')).toContain('cannot write it');
    expect(projectOrderingNote('priority', 'priority')).toContain('nothing left to decide');
    expect(projectOrderingNote('name', 'lead')).toBeNull();
  });
});
