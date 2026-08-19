import { afterEach, describe, expect, it } from 'vitest';

import {
  OUTDATED_CLIENT_MESSAGE,
  clearSchemaReloadAttempt,
  consumeSchemaReload,
  isOutdatedClientError,
  schemaReloadAlreadyAttempted,
} from './outdated-client';

afterEach(() => {
  clearSchemaReloadAttempt();
});

describe('outdated client recovery', () => {
  it('recognises the banner copy and nothing else', () => {
    expect(isOutdatedClientError(new Error(OUTDATED_CLIENT_MESSAGE))).toBe(true);
    expect(isOutdatedClientError(new Error('could not load the workspace'))).toBe(false);
    expect(isOutdatedClientError('no')).toBe(false);
  });

  it('auto-reloads once per tab and then refuses to loop', () => {
    expect(schemaReloadAlreadyAttempted()).toBe(false);
    expect(consumeSchemaReload()).toBe(true);
    expect(schemaReloadAlreadyAttempted()).toBe(true);
    expect(consumeSchemaReload()).toBe(false);
  });

  it('forgets the attempt after a successful boot so a later bump can recover again', () => {
    expect(consumeSchemaReload()).toBe(true);
    clearSchemaReloadAttempt();
    expect(consumeSchemaReload()).toBe(true);
  });
});
