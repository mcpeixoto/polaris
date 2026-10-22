import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setTitleParts, TITLE_SUFFIX } from '~/hooks/useDocumentTitle';

import { AuthLayout } from './AuthLayout';

/**
 * The frame names the tab for every screen a person sees before they are inside a workspace.
 *
 * Asserted on the frame rather than on the five screens that wear it, because the frame is
 * what holds the decision: sign-in, sign-up, accept-invite and create-a-workspace are one
 * journey with several entrances, and somebody bounced between them should be able to tell
 * from the tab which step they are on.
 */

afterEach(() => {
  setTitleParts([]);
});

describe('AuthLayout', () => {
  it('names the browser tab after the screen', () => {
    render(<AuthLayout title="Create a workspace" />);

    expect(document.title).toBe(`Create a workspace · ${TITLE_SUFFIX}`);
  });

  it('follows the screen when the journey moves on', () => {
    const { rerender } = render(<AuthLayout title="Sign in" />);
    expect(document.title).toBe(`Sign in · ${TITLE_SUFFIX}`);

    rerender(<AuthLayout title="Create a workspace" />);

    expect(document.title).toBe(`Create a workspace · ${TITLE_SUFFIX}`);
  });
});
