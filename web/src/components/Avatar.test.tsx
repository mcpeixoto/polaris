import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar } from './Avatar';

/**
 * A virtualised list mounts hundreds of these at once, most of them off screen. Unsized and
 * eager, that is hundreds of requests and a reflow per arrival.
 */
describe('Avatar images', () => {
  it('reserves its box and defers the request', () => {
    render(<Avatar name="Ada Lovelace" src="https://example.test/ada.png" size="sm" />);

    const image = screen.getByRole('img', { name: 'Ada Lovelace' }).querySelector('img');
    expect(image?.getAttribute('width')).toBe('20');
    expect(image?.getAttribute('height')).toBe('20');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
  });

  it('sizes the box from the variant', () => {
    render(<Avatar name="Grace Hopper" src="https://example.test/grace.png" size="md" />);

    const image = screen.getByRole('img', { name: 'Grace Hopper' }).querySelector('img');
    expect(image?.getAttribute('width')).toBe('24');
  });
});
