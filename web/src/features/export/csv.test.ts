import { describe, expect, it } from 'vitest';

import { csvEscape, exportCap, exportCapNote, toCsv } from './csv';

describe('csvEscape', () => {
  it('quotes commas, quotes and newlines, and doubles inner quotes', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a, b')).toBe('"a, b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });
});

describe('toCsv', () => {
  it('emits a trailing newline so the last row is a row', () => {
    const csv = toCsv(['ID', 'Title'], [['ENG-1', 'Fix the flake']]);
    expect(csv).toBe('ID,Title\nENG-1,Fix the flake\n');
  });
});

describe('exportCap', () => {
  it('refuses guests, caps members at 250 issues, and admins at 2,000', () => {
    expect(exportCap('guest', 'issues')).toBe(0);
    expect(exportCap('member', 'issues')).toBe(250);
    expect(exportCap('admin', 'issues')).toBe(2000);
    expect(exportCap('owner', 'projects')).toBe(200);
  });
});

describe('exportCapNote', () => {
  it('says nothing when the whole list fitted', () => {
    expect(exportCapNote(0, 250, 'issues')).toBeNull();
    expect(exportCapNote(249, 250, 'issues')).toBeNull();
    expect(exportCapNote(250, 250, 'issues')).toBeNull();
  });

  it('names both numbers when the cap took rows out', () => {
    expect(exportCapNote(300, 250, 'issues')).toBe(
      'Exported the first 250 of 300 issues. Narrow the list with a filter and export again for the rest.',
    );
    expect(exportCapNote(201, 200, 'projects')).toBe(
      'Exported the first 200 of 201 projects. Narrow the list with a filter and export again for the rest.',
    );
  });

  it('groups the thousands, because 2000 of 12000 is unreadable', () => {
    expect(exportCapNote(12_000, 2000, 'issues')).toContain('first 2,000 of 12,000 issues');
  });
});
