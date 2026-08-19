import { describe, expect, it } from 'vitest';

import { formatGitBranchName } from './branch';

describe('formatGitBranchName', () => {
  it('uses identifier then title by default', () => {
    expect(
      formatGitBranchName('', {
        identifier: 'ENG-42',
        title: 'The importer is broken',
        user: 'Ada Lovelace',
      }),
    ).toBe('eng-42-the-importer-is-broken');
  });

  it('prefixes the user and truncates to 80', () => {
    const got = formatGitBranchName('{user}/{identifier}-{title}', {
      identifier: 'ENG-1',
      title:
        'A very long title that should not produce an infinite git branch name because shells and GitHub both have limits',
      user: 'Ada Lovelace',
    });
    expect(got).toBe(
      'ada-lovelace/eng-1-a-very-long-title-that-should-not-produce-an-infinite-git-bra',
    );
    expect(got.length).toBeLessThanOrEqual(80);
  });

  it('strips punctuation', () => {
    expect(
      formatGitBranchName('{identifier}-{title}', {
        identifier: 'ENG-3',
        title: 'Fix: `foo` / bar?',
        user: '',
      }),
    ).toBe('eng-3-fix-foo-bar');
  });
});
