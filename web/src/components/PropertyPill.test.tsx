/**
 * A pill is read as "value, property": the value is what it shows, the property is what it
 * is described by. The interesting case is the empty one, where the visible text is the
 * property's name and the accessible name has to say that nothing is set.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PropertyPill } from './PropertyPill';

describe('PropertyPill', () => {
  it('is described by the property, so "In Progress" says it is the status', () => {
    render(
      <PropertyPill name="Status" describe="pill-status">
        In Progress
      </PropertyPill>,
    );

    const pill = screen.getByRole('button', { name: 'In Progress' });
    const described = pill.getAttribute('aria-describedby');
    expect(described).toBe('pill-status');
    expect(document.getElementById(described as string)?.textContent).toBe('Status');
  });

  // Otherwise the pill announces "Project, button" and leaves the reader to guess whether
  // a project is set.
  it('names an empty pill by what it is missing', () => {
    render(
      <PropertyPill name="Project" describe="pill-project" empty="No project">
        Project
      </PropertyPill>,
    );

    expect(screen.getByRole('button', { name: 'No project' })).toBeTruthy();
  });

  it('keeps the caller class alongside its own', () => {
    render(
      <PropertyPill name="Cycle" describe="pill-cycle" empty="No cycle" className="glyphOnly">
        Cycle
      </PropertyPill>,
    );

    expect(screen.getByRole('button', { name: 'No cycle' }).className).toContain('glyphOnly');
  });

  it('opens whatever the pill is a trigger for', async () => {
    const onClick = vi.fn();
    render(
      <PropertyPill name="Status" describe="pill-status" onClick={onClick}>
        Todo
      </PropertyPill>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Todo' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
