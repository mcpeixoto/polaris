/**
 * Textarea is not a controlled component any more, and this pins down that it still behaves
 * like one.
 *
 * The reason for the change is the browser's undo history and is argued in `nativeValue.ts`;
 * it cannot be tested here, because jsdom has no edit history to break — `web/e2e/
 * text-undo.spec.ts` owns that half in a real engine. What this file owns is the other half,
 * and the riskier one: the primitive is behind every long-form field in the product, and a
 * value that arrives from anywhere other than the keyboard has to land in the box exactly as
 * it did before. A remote delta, a composer cleared on submit, a switched entity, and text
 * the owner rewrote as it was typed are the four ways that happens.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Textarea } from './Textarea';
import { useNativeValue } from './nativeValue';

function area(): HTMLTextAreaElement {
  return screen.getByLabelText('Body') as HTMLTextAreaElement;
}

describe('Textarea', () => {
  it('shows the value it is given before anybody types', () => {
    render(<Textarea label="Body" value="from the replica" onChange={() => {}} />);
    expect(area().value).toBe('from the replica');
  });

  it('reports every character typed into it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Host() {
      const [value, setValue] = useState('');
      return (
        <Textarea
          label="Body"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setValue(event.target.value);
          }}
        />
      );
    }
    render(<Host />);

    await user.type(area(), 'quick brown fox');

    expect(area().value).toBe('quick brown fox');
    expect(onChange).toHaveBeenCalledTimes('quick brown fox'.length);
    expect(onChange).toHaveBeenLastCalledWith('quick brown fox');
  });

  it('adopts a value that changed from outside', () => {
    const view = render(<Textarea label="Body" value="mine" onChange={() => {}} />);
    view.rerender(<Textarea label="Body" value="theirs, over the socket" onChange={() => {}} />);
    expect(area().value).toBe('theirs, over the socket');
  });

  it('empties when the owner clears it, which is how a composer is reset on submit', async () => {
    const user = userEvent.setup();

    function Host() {
      const [value, setValue] = useState('');
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setValue('');
          }}
        >
          <Textarea label="Body" value={value} onChange={(event) => setValue(event.target.value)} />
          <button type="submit">Post</button>
        </form>
      );
    }
    render(<Host />);

    await user.type(area(), 'lgtm');
    expect(area().value).toBe('lgtm');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(area().value).toBe('');
  });

  it('keeps the owner as the authority when it rewrites what was typed', async () => {
    const user = userEvent.setup();

    // An owner that upper-cases as you go: the value on the screen is the one the owner
    // decided on, not the one the keyboard produced. Nothing in the app does this today, and
    // it is here because it is the property a caller would assume from the `value` prop.
    function Host() {
      const [value, setValue] = useState('');
      return (
        <Textarea
          label="Body"
          value={value}
          onChange={(event) => setValue(event.target.value.toUpperCase())}
        />
      );
    }
    render(<Host />);

    await user.type(area(), 'shout');
    expect(area().value).toBe('SHOUT');
  });

  it('leaves the caret where it was when text arrives around it', () => {
    const view = render(<Textarea label="Body" value="one two" onChange={() => {}} />);
    const element = area();
    element.focus();
    element.setSelectionRange(3, 3);

    view.rerender(<Textarea label="Body" value="one two three" onChange={() => {}} />);

    expect(element.value).toBe('one two three');
    expect(element.selectionStart).toBe(3);
  });

  it('clamps the caret when the arriving text is shorter than what was on screen', () => {
    const view = render(<Textarea label="Body" value="a long paragraph" onChange={() => {}} />);
    const element = area();
    element.focus();
    element.setSelectionRange(12, 16);

    view.rerender(<Textarea label="Body" value="short" onChange={() => {}} />);

    expect(element.value).toBe('short');
    expect(element.selectionStart).toBe(5);
    expect(element.selectionEnd).toBe(5);
  });
});

/**
 * Three screens keep their own textarea rather than the primitive — the description overlay,
 * and the two update composers, which are styled by the view around them. They call the hook
 * directly, and the thing that could go wrong there is ordering: the parent's effect runs
 * against a ref that the child textarea only just attached, and one of those textareas is
 * mounted by the same click that fills it.
 */
describe('useNativeValue on a caller-owned textarea', () => {
  function Host({ text, mounted }: { text: string; mounted: boolean }) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    useNativeValue(ref, text);
    return mounted ? <textarea ref={ref} aria-label="Body" readOnly /> : null;
  }

  it('fills a textarea that mounts after the value is already known', () => {
    const view = render(<Host text="the existing description" mounted={false} />);
    expect(screen.queryByLabelText('Body')).toBeNull();

    view.rerender(<Host text="the existing description" mounted />);
    expect(area().value).toBe('the existing description');
  });

  it('fills a textarea that mounts and is given its text in the same commit', () => {
    render(<Host text="opened for editing" mounted />);
    expect(area().value).toBe('opened for editing');
  });
});
