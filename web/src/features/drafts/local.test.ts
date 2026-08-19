import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllLocalDrafts,
  listLocalDrafts,
  readIssueComposerDraft,
  writeCommentDraft,
  writeIssueComposerDraft,
} from './local';

vi.mock('~/sync/api', () => ({
  currentWorkspace: () => 'ws-1',
}));

afterEach(() => {
  sessionStorage.clear();
});

describe('local issue drafts', () => {
  it('round-trips a titled composer and forgets an empty one', () => {
    writeIssueComposerDraft({
      kind: 'issue',
      title: 'Ship drafts',
      description: '',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(readIssueComposerDraft()?.title).toBe('Ship drafts');

    writeIssueComposerDraft({
      kind: 'issue',
      title: '   ',
      description: '',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(readIssueComposerDraft()).toBeNull();
  });
});

describe('local comment drafts', () => {
  it('keeps one draft per issue composer and lists it', () => {
    writeCommentDraft({ issueId: 'i1', body: 'half a thought' });
    writeCommentDraft({ issueId: 'i1', parentId: 'c1', body: 'a reply' });
    writeCommentDraft({ issueId: 'i1', body: 'replaced' });

    const listed = listLocalDrafts();
    const comments = listed.filter((row) => row.kind === 'comment');
    expect(comments).toHaveLength(2);
    expect(comments.some((row) => row.kind === 'comment' && row.body === 'replaced')).toBe(true);
    expect(comments.some((row) => row.kind === 'comment' && row.body === 'a reply')).toBe(true);
  });

  it('drops a comment whose body was cleared', () => {
    writeCommentDraft({ issueId: 'i1', body: 'gone in a moment' });
    writeCommentDraft({ issueId: 'i1', body: '' });
    expect(listLocalDrafts()).toEqual([]);
  });
});

describe('clearAllLocalDrafts', () => {
  it('wipes both the composer and every comment', () => {
    writeIssueComposerDraft({
      kind: 'issue',
      title: 'x',
      description: '',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    writeCommentDraft({ issueId: 'i1', body: 'y' });
    clearAllLocalDrafts();
    expect(listLocalDrafts()).toEqual([]);
  });
});
