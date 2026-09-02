import { describe, expect, it } from 'vitest';

import { isReplicaFailureMessage } from './replica-error';

describe('isReplicaFailureMessage', () => {
  it('recognises the transaction failure a missing object store produces', () => {
    // Verbatim from a production report, which is the point: this string is the only
    // thing the user ever sees, so it is the only thing available to match on.
    expect(
      isReplicaFailureMessage(
        "Failed to execute 'transaction' on 'IDBDatabase': One of the specified object stores was not found.",
      ),
    ).toBe(true);
  });

  it('recognises a replica that will not fit on disk', () => {
    expect(isReplicaFailureMessage('QuotaExceededError: the quota has been exceeded')).toBe(true);
  });

  it('leaves a network failure alone, because retrying that one works', () => {
    expect(isReplicaFailureMessage('Failed to fetch')).toBe(false);
    expect(isReplicaFailureMessage('could not load workspaces')).toBe(false);
  });
});
