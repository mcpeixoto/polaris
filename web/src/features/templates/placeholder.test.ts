import { describe, expect, it } from 'vitest';

import {
  placeholderSpans,
  togglePlaceholder,
  unwrapPlaceholders,
  wrapPlaceholder,
} from './placeholder';

describe('Aa placeholder marks', () => {
  it('wraps selected text so the filer can see a prompt', () => {
    expect(wrapPlaceholder('Steps to reproduce')).toBe('⟦Steps to reproduce⟧');
  });

  it('unwraps remaining prompts when the issue is filed', () => {
    expect(unwrapPlaceholders('## Impact\n\n⟦What broke⟧\n')).toBe('## Impact\n\nWhat broke\n');
  });

  it('finds every prompt so the create dialog can select one', () => {
    expect(placeholderSpans('⟦one⟧ and ⟦two⟧')).toEqual([
      { start: 0, end: 5, text: 'one' },
      { start: 10, end: 15, text: 'two' },
    ]);
  });

  it('toggles a selection on and off', () => {
    const wrapped = togglePlaceholder('hello world', 6, 11);
    expect(wrapped.body).toBe('hello ⟦world⟧');
    const undone = togglePlaceholder(wrapped.body, wrapped.start, wrapped.end);
    expect(undone.body).toBe('hello world');
  });
});
