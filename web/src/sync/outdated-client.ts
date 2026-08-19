/**
 * Recovery for a bootstrap whose `clientSchema` disagrees with this build.
 *
 * Reloading the page is the only client-side action that can help: it picks up a newly
 * deployed bundle. Retrying the same JavaScript against the same server cannot. We still
 * only auto-reload once per tab, because a persistent disagreement — this source tree at
 * one version, a binary compiled at another — is not a stale cache, and looping would
 * trap the user on a blank flash forever.
 */

export const OUTDATED_CLIENT_MESSAGE =
  'this version of the app is out of date — reload to update';

const RELOAD_ONCE_KEY = 'polaris.schemaReload';

export function isOutdatedClientError(err: unknown): boolean {
  return err instanceof Error && isOutdatedClientMessage(err.message);
}

export function isOutdatedClientMessage(message: string): boolean {
  return message === OUTDATED_CLIENT_MESSAGE;
}

export function schemaReloadAlreadyAttempted(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_ONCE_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearSchemaReloadAttempt(): void {
  try {
    sessionStorage.removeItem(RELOAD_ONCE_KEY);
  } catch {
    /* Safari private mode and sandboxed iframes throw. */
  }
}

/**
 * True when the caller should `location.reload()` now.
 *
 * The first call in a tab returns true and remembers; later calls return false so a
 * mismatch that reload cannot fix does not loop.
 */
export function consumeSchemaReload(): boolean {
  if (schemaReloadAlreadyAttempted()) return false;
  try {
    sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
  } catch {
    return false;
  }
  return true;
}
