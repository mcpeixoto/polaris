import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteFallback, fallbackVariantFor } from './RouteFallback';

describe('fallbackVariantFor', () => {
  it.each([
    ['/settings', 'settings'],
    ['/settings/members', 'settings'],
    ['/settings/teams/ENG/general', 'settings'],
    ['/issue/ENG-12', 'detail'],
    ['/project/abc/issues', 'detail'],
    ['/document/abc', 'detail'],
    ['/customer/abc', 'detail'],
    ['/initiative/abc/activity', 'detail'],
    ['/cycle/abc', 'detail'],
    ['/dashboard/abc', 'detail'],
    ['/team/ENG/home', 'detail'],
    ['/team/ENG', 'list'],
    ['/team/ENG/triage', 'list'],
    ['/my-issues', 'list'],
    ['/inbox', 'list'],
    ['/projects', 'list'],
    // Not a settings page: the prefix has to be a whole segment, or /settingsish would match.
    ['/settingsish', 'list'],
    // Anything unrecognised is a list, which is what most screens are.
    ['/nowhere', 'list'],
  ])('maps %s to the %s shape', (pathname, variant) => {
    expect(fallbackVariantFor(pathname)).toBe(variant);
  });
});

describe('RouteFallback', () => {
  it.each(['list', 'detail', 'settings'] as const)(
    'announces the %s shape once and nothing inside it',
    (variant) => {
      const { container } = render(<RouteFallback variant={variant} />);

      // One region says the pane is loading. The blocks are decoration and stay out of the
      // accessibility tree, which is the contract Skeleton documents.
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(container.querySelectorAll('span:not([aria-hidden="true"])')).toHaveLength(0);
    },
  );

  it('defaults to the list shape', () => {
    const { container } = render(<RouteFallback />);
    expect(container.querySelectorAll('span[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
