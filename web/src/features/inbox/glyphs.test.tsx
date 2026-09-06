import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { NotificationType } from '~/store';

import { GLYPH_TYPES, notificationGlyph } from './glyphs';

describe('notificationGlyph', () => {
  it('draws a badge for every notification type', () => {
    for (const type of GLYPH_TYPES) {
      const { container, unmount } = render(notificationGlyph(type));
      expect(container.querySelector('svg[aria-hidden="true"]'), type).not.toBeNull();
      unmount();
    }
  });

  it('still draws something for a type a newer server invents', () => {
    const { container } = render(notificationGlyph('issue_exploded' as NotificationType));
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('gives a comment and a completion different pictures', () => {
    const a = render(notificationGlyph('comment')).container.innerHTML;
    const b = render(notificationGlyph('sub_issue_completed')).container.innerHTML;
    expect(a).not.toBe(b);
  });
});
