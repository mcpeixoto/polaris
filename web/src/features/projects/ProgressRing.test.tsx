import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressRing } from './ProgressRing';

describe('ProgressRing', () => {
  it('names itself with the ratio when one is given, and the percentage otherwise', () => {
    render(<ProgressRing percent={40} label="Launch" detail="2 of 5 issues completed" />);
    expect(screen.getByRole('img', { name: 'Launch: 2 of 5 issues completed' })).toBeTruthy();
  });

  it('clamps rather than throwing on a rollup outside 0–100', () => {
    render(<ProgressRing percent={140} label="Launch" />);
    expect(screen.getByRole('img', { name: 'Launch: 100%' })).toBeTruthy();
  });
});
