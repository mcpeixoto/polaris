/**
 * The MCP page is three values somebody copies, so what is worth guarding is that the copy
 * controls are distinguishable from one another and that the confirmation goes somewhere a
 * screen reader hears it. All three used to share the name "Copy URL"/"Copy command" and to
 * rename themselves "Copied" on success, permanently.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { McpSettings } from './McpSettings';

function renderPage() {
  render(
    <MemoryRouter>
      <McpSettings />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('McpSettings', () => {
  it('names each copy button after the row it belongs to', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Copy URL — Read and write' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy URL — Read only' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy command — Add the server' })).toBeTruthy();
  });

  it('confirms in a live region and keeps the button called what it does', async () => {
    const user = renderPage();
    const button = screen.getByRole('button', { name: 'Copy URL — Read and write' });

    await user.click(button);

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/mcp`);
    expect(screen.getByRole('button', { name: 'Copy URL — Read and write' })).toBe(button);
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Copied')).toBe(true);
  });
});
