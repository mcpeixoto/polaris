import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setTitleBadge, setTitleParts, TITLE_SUFFIX, useDocumentTitle } from './useDocumentTitle';

/**
 * The regression these exist for is the second one: the badge used to compose onto the
 * literal 'Polaris', so the first screen that named itself in the tab would have had its name
 * erased by the next unread-count delta.
 */

afterEach(() => {
  setTitleBadge(0);
  setTitleParts([]);
});

function Screen({ parts }: { parts: string[] }) {
  useDocumentTitle(parts);
  return null;
}

describe('useDocumentTitle', () => {
  it('names the screen ahead of the product', () => {
    render(<Screen parts={['Fix the thing', 'ENG-42']} />);

    expect(document.title).toBe(`Fix the thing · ENG-42 · ${TITLE_SUFFIX}`);
  });

  it('falls back to the bare product name when a screen claims nothing', () => {
    render(<Screen parts={[]} />);

    expect(document.title).toBe(TITLE_SUFFIX);
  });

  it('keeps the screen name when the unread badge changes', () => {
    render(<Screen parts={['My issues']} />);

    setTitleBadge(3);
    expect(document.title).toBe(`(3) My issues · ${TITLE_SUFFIX}`);

    setTitleBadge(0);
    expect(document.title).toBe(`My issues · ${TITLE_SUFFIX}`);
  });

  it('keeps the badge when the screen changes', () => {
    const { rerender } = render(<Screen parts={['My issues']} />);
    setTitleBadge(2);

    rerender(<Screen parts={['Inbox']} />);

    expect(document.title).toBe(`(2) Inbox · ${TITLE_SUFFIX}`);
  });
});
