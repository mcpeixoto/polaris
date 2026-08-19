import { describe, expect, it } from 'vitest';

import { buildCreateURL, parseCreateURL, parseEstimate, parsePriority } from './create-url';

describe('parseCreateURL', () => {
  it('reads the documented keys, including the singular label alias', () => {
    const params = parseCreateURL(
      new URLSearchParams(
        'title=Fix+the+flake&description=it+flakes&priority=Urgent&assignee=me&label=bug,infra',
      ),
      'ENG',
    );
    expect(params).toEqual({
      title: 'Fix the flake',
      description: 'it flakes',
      team: 'ENG',
      priority: 'Urgent',
      assignee: 'me',
      labels: 'bug,infra',
    });
  });

  it('lets an explicit team query override the path', () => {
    const params = parseCreateURL(new URLSearchParams('team=DES'), 'ENG');
    expect(params.team).toBe('DES');
  });

  it('drops blank values so a bookmark of empty params is an empty composer', () => {
    const params = parseCreateURL(new URLSearchParams('title=&priority='));
    expect(params).toEqual({});
  });

  it('accepts projectMilestone as the documented alias of milestone', () => {
    const params = parseCreateURL(new URLSearchParams('milestone=Beta'));
    expect(params.milestone).toBe('Beta');
    const aliased = parseCreateURL(new URLSearchParams('projectMilestone=Beta'));
    expect(aliased.milestone).toBe('Beta');
  });
});

describe('parsePriority', () => {
  it('accepts the product words and the numeric scale', () => {
    expect(parsePriority('Urgent')).toBe(1);
    expect(parsePriority('high')).toBe(2);
    expect(parsePriority('3')).toBe(3);
    expect(parsePriority('nope')).toBe(0);
  });
});

describe('parseEstimate', () => {
  it('maps T-shirt sizes onto the Fibonacci points the docs name', () => {
    expect(parseEstimate('XS')).toBe(1);
    expect(parseEstimate('M')).toBe(3);
    expect(parseEstimate('XXL')).toBe(13);
    expect(parseEstimate('8')).toBe(8);
    expect(parseEstimate('nope')).toBeUndefined();
  });
});

describe('buildCreateURL', () => {
  it('omits empty fields so a copy of a blank composer is just /new', () => {
    expect(buildCreateURL({})).toBe('/new');
  });

  it('puts the team in the path and the rest on the query', () => {
    expect(
      buildCreateURL({
        teamKey: 'ENG',
        title: 'Fix the flake',
        priority: 1,
      }),
    ).toBe('/team/ENG/new?title=Fix+the+flake&priority=Urgent');
  });
});
