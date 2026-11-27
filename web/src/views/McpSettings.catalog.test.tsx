/**
 * The short-list endpoint is offered beside the other two, as a row a reader can copy.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { McpSettings } from './McpSettings';

describe('McpSettings catalog endpoint', () => {
  it('shows the /mcp/catalog URL in its own labelled row', () => {
    render(
      <MemoryRouter>
        <McpSettings />
      </MemoryRouter>,
    );
    expect(screen.getByText('Short tool list')).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/mcp/catalog`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy URL — Short tool list' })).toBeTruthy();
  });
});
