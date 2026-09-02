import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CopyButton } from './CopyButton';

/**
 * The three defects this primitive exists to stop, one test each.
 *
 * Every one of them was live in three screens at once — the Ask link, the MCP endpoints and
 * the MCP command — because each had hand-rolled `copyText(v).then(ok => ok && setCopied(…))`
 * and none of them had thought about the `false`.
 */

/**
 * `userEvent.setup()` installs the clipboard the component writes to, so the refusal cases
 * are made by taking that one away or making it reject — not by stubbing `navigator`, which
 * is a getter that the stub does not reach.
 */
function removeClipboard() {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
}

describe('CopyButton', () => {
  it('announces the copy in a live region rather than renaming its own button', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="https://example.com/ask/abc" label="Copy link" />);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(screen.getByRole('status').textContent).toBe('Copied');
    // Still called what it does. The old version's accessible name became "Copied" for the
    // rest of the session, so the control stopped naming its own action.
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  /**
   * The `false` branch: no `navigator.clipboard` at all, which is every insecure origin.
   * The old code did nothing here, so the button looked broken precisely when it had failed.
   */
  it('selects the value when the clipboard is missing, so the platform copy still works', async () => {
    const user = userEvent.setup();
    removeClipboard();
    render(<CopyButton value="polaris-token" />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    const fallback = document.querySelector('input');
    expect(fallback).not.toBeNull();
    expect(document.activeElement).toBe(fallback);
    expect((fallback as HTMLInputElement).selectionStart).toBe(0);
    expect((fallback as HTMLInputElement).selectionEnd).toBe('polaris-token'.length);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('falls back the same way when the write is refused', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<CopyButton value="polaris-token" />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await screen.findByRole('status');
    expect(document.activeElement).toBe(document.querySelector('input'));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('takes an accessible name for a list of otherwise identical buttons', () => {
    render(<CopyButton value="x" label="Copy URL" ariaLabel="Copy URL — read only" />);
    expect(screen.getByRole('button', { name: 'Copy URL — read only' })).toBeTruthy();
  });
});
