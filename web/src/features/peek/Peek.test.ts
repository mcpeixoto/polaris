import { describe, expect, it } from 'vitest';

import { glanceDescription } from './Peek';

describe('glanceDescription', () => {
  it('keeps a short description intact', () => {
    expect(glanceDescription('Fix the login.')).toBe('Fix the login.');
  });

  it('collapses extra blank lines', () => {
    expect(glanceDescription('One\n\n\n\nTwo')).toBe('One\n\nTwo');
  });

  it('cuts a novel at a word boundary', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const out = glanceDescription(long, 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(50);
    expect(out.includes(' ')).toBe(true);
  });
});
