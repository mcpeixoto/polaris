import { describe, expect, it, vi } from 'vitest';

import type { MenuItem, MenuNode } from '~/components';

import { entityRowMenuItems } from './entityRowMenu';

function items(nodes: readonly MenuNode[]): MenuItem[] {
  return nodes.filter((node): node is MenuItem => node.kind === undefined);
}

function byId(nodes: readonly MenuNode[], id: string): MenuItem | undefined {
  return items(nodes).find((item) => item.id === id);
}

describe('entityRowMenuItems', () => {
  it('orders Open, Copy link, Favorite, properties, then Archive/Delete', () => {
    const nodes = entityRowMenuItems(
      { noun: 'project', favorited: false },
      {
        open: vi.fn(),
        copyLink: vi.fn(),
        toggleFavorite: vi.fn(),
        properties: [{ id: 'status', label: 'Status…', onSelect: vi.fn() }],
        archive: vi.fn(),
        askDelete: vi.fn(),
      },
    );

    expect(items(nodes).map((item) => item.id)).toEqual([
      'open',
      'copy-link',
      'favorite',
      'status',
      'archive',
      'delete',
    ]);
  });

  it('uses Add/Remove from favourites wording', () => {
    const add = entityRowMenuItems(
      { noun: 'document' },
      { open: vi.fn(), toggleFavorite: vi.fn() },
    );
    expect(byId(add, 'favorite')?.label).toBe('Add to favourites');

    const remove = entityRowMenuItems(
      { noun: 'document', favorited: true },
      { open: vi.fn(), toggleFavorite: vi.fn() },
    );
    expect(byId(remove, 'favorite')?.label).toBe('Remove from favourites');
  });
});
