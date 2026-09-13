/**
 * One click on "Upgrade" or "Manage billing" has to open Stripe exactly once, and leave the
 * app where it was. It used to open twice on both surfaces: `null` from `window.open` was
 * read as "blocked" and followed by a navigation, but the desktop shell returns `null` after
 * it has already opened the system browser, and `noopener` makes browsers return `null` too.
 */

import { describe, expect, it, vi } from 'vitest';

import { openExternalUrl } from './runtime';

const STRIPE = 'https://checkout.stripe.com/c/pay/cs_test';

describe('openExternalUrl', () => {
  it('opens once on desktop and never navigates the app window', () => {
    const open = vi.fn(() => null);
    const assign = vi.fn();

    openExternalUrl(STRIPE, { desktop: true, open, assign });

    expect(open).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('opens a tab on the web without also navigating this one', () => {
    const popup = { opener: {} } as unknown as Window;
    const open = vi.fn(() => popup);
    const assign = vi.fn();

    openExternalUrl(STRIPE, { desktop: false, open, assign });

    expect(open).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    expect(popup.opener).toBeNull();
  });

  it('navigates in place on the web only when the popup was blocked', () => {
    const open = vi.fn(() => null);
    const assign = vi.fn();

    openExternalUrl(STRIPE, { desktop: false, open, assign });

    expect(assign).toHaveBeenCalledWith(STRIPE);
  });
});
