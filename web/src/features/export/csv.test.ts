import { describe, expect, it } from 'vitest';

import { csvEscape, csvGuard, downloadCsv, exportCap, exportCapNote, toCsv } from './csv';

describe('csvEscape', () => {
  it('quotes commas, quotes and newlines, and doubles inner quotes', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a, b')).toBe('"a, b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });
});

describe('csvGuard', () => {
  it('defuses the cells a spreadsheet would execute', () => {
    expect(csvGuard('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvGuard("=SUM(A1:A9)+cmd|'/c calc'!A0")).toBe("'=SUM(A1:A9)+cmd|'/c calc'!A0");
    expect(csvGuard('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvGuard('-2+3+cmd|calc')).toBe("'-2+3+cmd|calc");
    expect(csvGuard('@SUM(1)')).toBe("'@SUM(1)");
    expect(csvGuard('\t=1+1')).toBe("'\t=1+1");
    expect(csvGuard('\r=1+1')).toBe("'\r=1+1");
  });

  it('leaves ordinary text and plain numbers exactly as they were', () => {
    expect(csvGuard('Fix the flake')).toBe('Fix the flake');
    expect(csvGuard('a = b')).toBe('a = b');
    expect(csvGuard('')).toBe('');
    expect(csvGuard('-5')).toBe('-5');
    expect(csvGuard('-1.5')).toBe('-1.5');
    expect(csvGuard('+3')).toBe('+3');
    expect(csvGuard('-1e3')).toBe('-1e3');
  });
});

describe('csvEscape', () => {
  it('quotes a guarded cell so the apostrophe cannot be read as data', () => {
    expect(csvEscape('=1+1')).toBe('"\'=1+1"');
    expect(csvEscape('=HYPERLINK("http://x","go")')).toBe('"\'=HYPERLINK(""http://x"",""go"")"');
  });
});

describe('toCsv', () => {
  it('separates records with CRLF, as RFC 4180 and Excel both expect', () => {
    const csv = toCsv(['ID', 'Title'], [['ENG-1', 'Fix the flake']]);
    expect(csv).toBe('ID,Title\r\nENG-1,Fix the flake\r\n');
  });

  it('leaves a newline inside a field alone — that one is data, not a record break', () => {
    const csv = toCsv(['Title'], [['line\nbreak']]);
    expect(csv).toBe('Title\r\n"line\nbreak"\r\n');
  });

  it('carries the guard through a whole row', () => {
    const csv = toCsv(['ID', 'Title'], [['ENG-1', '=SUM(A1:A9)+cmd|calc']]);
    expect(csv).toBe('ID,Title\r\nENG-1,"\'=SUM(A1:A9)+cmd|calc"\r\n');
  });
});

/**
 * The blob's actual bytes.
 *
 * Read as text rather than as a buffer and the BOM disappears: decoding a UTF-8 stream
 * consumes it as the encoding signal, which is the whole point of writing it and also the
 * reason a text-level assertion here would pass against a file that has no BOM at all.
 */
function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('downloadCsv', () => {
  it('writes a UTF-8 BOM so Excel does not mangle accents and kanji', async () => {
    const created: Blob[] = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      created.push(blob);
      return 'blob:test';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    try {
      downloadCsv('issues.csv', toCsv(['Title'], [['résumé 日本語']]));
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    expect(created).toHaveLength(1);
    const bytes = await readBlobBytes(created[0]!);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toContain('résumé 日本語');
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
