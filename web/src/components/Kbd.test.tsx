import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Kbd } from './Kbd';

function caps(): string[] {
  return [...document.querySelectorAll('kbd')].map((cap) => cap.textContent ?? '');
}

/**
 * One cap per key that is actually pressed. `⌘⇧K` in a single box draws a chord as though it
 * were one key; three boxes draw it as the three things the hand does.
 */
describe('Kbd', () => {
  it('draws a modified chord as one cap per key on Apple', () => {
    render(<Kbd keys="mod+shift+k" platform="mac" />);
    expect(caps()).toEqual(['⇧', '⌘', 'K']);
  });

  it('draws the same chord with the platform’s own words elsewhere', () => {
    render(<Kbd keys="mod+shift+k" platform="other" />);
    expect(caps()).toEqual(['Ctrl', 'Shift', 'K']);
  });

  it('keeps a sequence as two runs of caps', () => {
    render(<Kbd keys="g i" platform="mac" />);
    expect(caps()).toEqual(['G', 'I']);
  });

  it('leaves an unmodified named key as a single cap', () => {
    render(<Kbd keys="Escape" platform="mac" />);
    expect(caps()).toEqual(['Esc']);
  });

  it('takes its chip surface from a prop rather than from whoever contains it', () => {
    render(
      <>
        <span data-testid="page">
          <Kbd keys="k" platform="mac" />
        </span>
        <span data-testid="raised">
          <Kbd keys="k" platform="mac" surface="raised" />
        </span>
      </>,
    );

    const [onPage] = screen.getByTestId('page').querySelectorAll('kbd');
    const [onRaised] = screen.getByTestId('raised').querySelectorAll('kbd');
    expect(onPage?.className).not.toBe(onRaised?.className);
  });
});
