import { describe, expect, it } from 'vitest';

import { insertAtCaret } from './pasteImages';
import { isImageFile, markdownImage, imageFilesFromDataTransfer } from './upload';

describe('markdownImage', () => {
  it('builds a markdown image whose alt strips brackets', () => {
    expect(markdownImage('shot[1].png', '/files/x?token=y')).toBe('![shot1.png](/files/x?token=y)');
  });
});

describe('insertAtCaret', () => {
  it('inserts at the caret and advances it', () => {
    const next = insertAtCaret({ text: 'ab', caret: 1 }, 'X');
    expect(next).toEqual({ text: 'aXb', caret: 2 });
  });

  it('starts a new line when the caret is mid-paragraph', () => {
    const next = insertAtCaret({ text: 'hello', caret: 5 }, '![a](u)');
    expect(next.text).toBe('hello\n![a](u)');
  });
});

describe('isImageFile', () => {
  it('accepts PNG by type or extension', () => {
    expect(isImageFile(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isImageFile(new File([], 'a.png', { type: '' }))).toBe(true);
    expect(isImageFile(new File([], 'a.txt', { type: 'text/plain' }))).toBe(false);
  });
});

describe('imageFilesFromDataTransfer', () => {
  it('returns nothing without a data transfer', () => {
    expect(imageFilesFromDataTransfer(null)).toEqual([]);
  });
});
