import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '~/sync/api';

import { report } from './report';
import { clearToasts, type ToastRequest } from './ToastHost';

/**
 * The behaviour that had no test of its own while the code sat in `features/issue/mutations`,
 * and the reason moving it needed one first: the offline suppression. A queued write has not
 * failed — the outbox will send it and the connection indicator is already saying the one
 * true thing — so a toast per queued mutation while a laptop is on a train is the product
 * shouting about something that is going to work.
 *
 * `offerError` is spied rather than rendered. What is asserted here is the decision report
 * makes, not the host's announcement of it, which `ToastHost`'s own tests cover.
 */

const raised: ToastRequest[] = [];

vi.mock('./ToastHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ToastHost')>();
  return {
    ...actual,
    offerError: (request: Omit<ToastRequest, 'tone'>) => {
      raised.push({ ...request, tone: 'error' });
      return 'spied';
    },
  };
});

beforeEach(() => {
  raised.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearToasts();
});

describe('report', () => {
  it('says nothing at all when the request never left the client', () => {
    report(new ApiError('NETWORK', 'Failed to fetch'));

    expect(raised).toEqual([]);
  });

  it("passes the server's own sentence as the detail under a written headline", () => {
    report(new ApiError('VALIDATION', 'A cycle cannot start before the one before it ends.'), {
      title: "Couldn't move cycle",
    });

    expect(raised).toHaveLength(1);
    expect(raised[0]?.title).toBe("Couldn't move cycle");
    expect(raised[0]?.description).toBe('A cycle cannot start before the one before it ends.');
  });

  it('keeps a programming fault out of the user-facing text', () => {
    report(new TypeError('cannot read properties of undefined'));

    expect(raised).toHaveLength(1);
    expect(raised[0]?.title).toBe("Couldn't save that change");
    expect(raised[0]?.description).toBeUndefined();
  });

  it('offers the retry the caller supplied, and nothing when there is none', () => {
    const retry = vi.fn();
    report(new ApiError('INTERNAL', 'Something broke.'), { retry });
    report(new ApiError('INTERNAL', 'Something broke.'));

    expect(raised[0]?.retry).toBe(retry);
    expect(raised[1]?.retry).toBeUndefined();
  });
});
