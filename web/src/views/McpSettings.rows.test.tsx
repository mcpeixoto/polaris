/**
 * The MCP page as rows: each endpoint is a labelled row whose value is on the page as text,
 * beside a copy button named after the row.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { McpSettings } from './McpSettings';

function renderPage() {
  render(
    <MemoryRouter>
      <McpSettings />
    </MemoryRouter>,
  );
}

describe('McpSettings rows', () => {
  it('shows each endpoint as a value the reader can find on the page', () => {
    renderPage();
    const origin = window.location.origin;
    expect(screen.getByText(`${origin}/mcp`)).toBeTruthy();
    expect(screen.getByText(`${origin}/mcp/readonly`)).toBeTruthy();
    expect(screen.getByText(`claude mcp add --transport http polaris ${origin}/mcp`)).toBeTruthy();
  });

  it('labels the rows and links to the keys page', () => {
    renderPage();
    expect(screen.getByText('Read and write')).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.getByText('Add the server')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an API key' }).getAttribute('href')).toBe(
      '/settings/api-keys',
    );
  });
});
