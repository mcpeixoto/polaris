import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Markdown } from './Markdown';

afterEach(cleanup);

describe('Markdown mentions', () => {
  it('renders @[Name](user:uuid) as @Name', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { container } = render(<Markdown source={`Hi @[Ada](user:${id})`} />);
    const mention = container.querySelector('[data-user-id]') as HTMLElement;
    expect(mention.textContent).toBe('@Ada');
    expect(mention.getAttribute('data-user-id')).toBe(id);
    expect(container.textContent).toBe('Hi @Ada');
  });
});
