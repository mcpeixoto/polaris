/**
 * What the shell does with the address a session is created at.
 *
 * Signing in does not navigate — the signed-out catch-all keeps the URL so a deep link
 * survives the form, and the social providers redirect back to /signin by registration — so
 * the shell is mounted on an auth path every time somebody signs in from the form. It used
 * to fall through to the shell's catch-all and answer a successful sign-in with a 404.
 *
 * The redirect happens before AppShell is reached, which is why this needs no workspace,
 * engine or replica: if the assertion below ever fails it fails by rendering the shell.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { SignedInShell } from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>The issue list</p>} />
        <Route path="*" element={<SignedInShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the shell on a signed-out-only address', () => {
  it.each(['/signin', '/signup'])('sends %s to the home view rather than to a 404', (path) => {
    renderAt(path);

    expect(screen.getByText('The issue list')).not.toBeNull();
    expect(screen.queryByText('Page not found')).toBeNull();
  });
});
