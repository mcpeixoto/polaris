import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ColorPicker, contrastRatio, SWATCHES } from './ColorPicker';

describe('ColorPicker', () => {
  // The defect this component exists for: React maps a colour input's onChange to the DOM
  // `input` event, which fires on every frame of a drag — so the old control emitted dozens
  // of mutations for one colour, each with its own version and change row.
  it('reports one colour per choice, not one per keystroke', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker label="Colour of Bug" value="#6b7280" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Colour of Bug' }));
    const hex = screen.getByLabelText('Colour of Bug: hex value');
    await user.clear(hex);
    await user.type(hex, '#3b82f6');
    expect(onChange).not.toHaveBeenCalled();

    await user.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#3b82f6');
  });

  it('commits a swatch on the click that chose it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker label="Colour" value="#6b7280" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Colour' }));
    await user.click(screen.getByRole('button', { name: '#16a34a' }));
    expect(onChange).toHaveBeenCalledWith('#16a34a');
  });

  it('marks the current value as the chosen swatch', async () => {
    const user = userEvent.setup();
    render(<ColorPicker label="Colour" value="#16A34A" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Colour' }));
    expect(screen.getByRole('button', { name: '#16a34a' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  // A value the workspace typed is theirs to keep — the component says what it costs and
  // does not refuse it.
  it('puts a malformed value back rather than sending it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorPicker label="Colour" value="#6b7280" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Colour' }));
    const hex = screen.getByLabelText('Colour: hex value');
    await user.clear(hex);
    await user.type(hex, 'not a colour');
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect((hex as HTMLInputElement).value).toBe('#6b7280');
  });

  it('warns when a colour is faint against one of the two page colours', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ColorPicker label="Colour" value="#3b82f6" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Colour' }));
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<ColorPicker label="Colour" value="#fefefe" onChange={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('faint');
  });

  // The set is the component's own claim about itself, so it is checked rather than asserted
  // in a comment: a swatch swapped for a prettier value that fails the floor would otherwise
  // make the picker warn about its own defaults.
  it('offers only swatches that clear the floor against both page colours', () => {
    for (const swatch of SWATCHES) {
      expect(contrastRatio(swatch), swatch).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('contrastRatio', () => {
  // The minimum of the two grounds, not the ratio against whichever page happens to be up:
  // a label colour is chosen once and rendered in both themes.
  it('takes the worse of the light and dark grounds', () => {
    expect(contrastRatio('#ffffff')).toBeLessThan(1.5);
    expect(contrastRatio('#000000')).toBeLessThan(1.5);
    expect(contrastRatio('#3b82f6')).toBeGreaterThan(3);
    // The grey this product defaults a status to sits just under the floor, which is the
    // kind of thing the warning exists to say out loud.
    expect(contrastRatio('#6b7280')).toBeLessThan(3);
  });

  it('treats a value it cannot parse as no warning at all', () => {
    expect(contrastRatio('nonsense')).toBeGreaterThan(3);
  });
});
