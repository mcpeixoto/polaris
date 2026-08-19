import { describe, expect, it } from 'vitest';

import { csvEscape, exportCap, toCsv } from './csv';

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
