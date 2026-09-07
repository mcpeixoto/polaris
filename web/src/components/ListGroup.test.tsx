import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListGroup } from './ListGroup';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ListGroup', () => {
  it('says which way it is folded and hides its rows when shut', async () => {
    const user = userEvent.setup();
    render(
      <ListGroup groupKey="done" name="Done" count={3} preferenceKey="projects">
        <p>a project</p>
      </ListGroup>,
    );

    const toggle = screen.getByRole('button', { name: /Done/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('a project')).not.toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('a project')).toBeNull();
  });

  it('reads the count out, because it is the one fact the rows do not carry', () => {
    render(
      <ListGroup groupKey="done" name="Done" count={3}>
        <p>a project</p>
      </ListGroup>,
    );
    expect(screen.queryByRole('button', { name: 'Done 3' })).not.toBeNull();
  });

  it('opens shut when this screen remembers it shut, and only for this screen', async () => {
    const user = userEvent.setup();
    const view = render(
      <ListGroup groupKey="done" name="Done" count={3} preferenceKey="projects">
        <p>a project</p>
      </ListGroup>,
    );
    await user.click(screen.getByRole('button', { name: /Done/ }));
    view.unmount();

    render(
      <ListGroup groupKey="done" name="Done" count={3} preferenceKey="projects">
        <p>a project</p>
      </ListGroup>,
    );
    expect(screen.getByRole('button', { name: /Done/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    cleanup();

    render(
      <ListGroup groupKey="done" name="Done" count={3} preferenceKey="cycles">
        <p>a cycle</p>
      </ListGroup>,
    );
    expect(screen.getByRole('button', { name: /Done/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('remembers nothing at all for a screen with no preference key', async () => {
    const user = userEvent.setup();
    const view = render(
      <ListGroup groupKey="done" name="Done" count={3}>
        <p>a row</p>
      </ListGroup>,
    );
    await user.click(screen.getByRole('button', { name: /Done/ }));
    view.unmount();

    render(
      <ListGroup groupKey="done" name="Done" count={3}>
        <p>a row</p>
      </ListGroup>,
    );
    expect(screen.getByRole('button', { name: /Done/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('folds one sibling without unfolding the others', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ListGroup groupKey="todo" name="Todo" count={1} preferenceKey="projects">
          <p>one</p>
        </ListGroup>
        <ListGroup groupKey="done" name="Done" count={2} preferenceKey="projects">
          <p>two</p>
        </ListGroup>
      </>,
    );

    await user.click(screen.getByRole('button', { name: /Todo/ }));
    await user.click(screen.getByRole('button', { name: /Done/ }));

    expect(
      JSON.parse(window.localStorage.getItem('polaris.collapsedGroups:projects') ?? '[]'),
    ).toEqual(['todo', 'done']);
  });

  it('tells the caller after every fold, for a list that has to re-measure', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <ListGroup groupKey="done" name="Done" count={3} onToggle={onToggle}>
        <p>a row</p>
      </ListGroup>,
    );

    await user.click(screen.getByRole('button', { name: /Done/ }));
    expect(onToggle).toHaveBeenCalledWith('done', true);
  });
});
