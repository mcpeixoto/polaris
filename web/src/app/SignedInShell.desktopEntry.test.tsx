/**
 * The address the packaged desktop app boots at.
 *
 * Electron loads the renderer from `app://polaris/index.html`, so `/index.html` is the
 * pathname the router sees on every launch — and on the first render after signing in. It
 * is not a route; it fell through to the shell's catch-all and greeted a successful sign-in
 * with "Nothing in this workspace answers to /index.html".
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { SignedInShell } from './App';

describe('the shell on the desktop entry document', () => {
  it('sends /index.html to the home view rather than to a 404', () => {
    render(
      <MemoryRouter initialEntries={['/index.html']}>
        <Routes>
          <Route path="/" element={<p>The issue list</p>} />
          <Route path="*" element={<SignedInShell />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('The issue list')).not.toBeNull();
    expect(screen.queryByText('Page not found')).toBeNull();
  });
});
