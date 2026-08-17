/**
 * The API key writes, and the vocabulary the screen needs to describe one.
 *
 * Neither write goes through `engine.mutate`, and that is the most important thing in this
 * file rather than an oversight.
 *
 * **Creating.** The response carries a token the server keeps only as a SHA-256, so it exists
 * in that one reply and nowhere else. The outbox replays a queued mutation by re-sending its
 * variables and *discarding* the result — which is exactly right for an issue title and
 * catastrophic here: a create that succeeded an hour later would mint a live credential
 * nobody can ever read, leaving the user a row in a table and a revoke button. So this is a
 * plain `gql` call. It succeeds now, in front of the person who asked for it, or it fails now
 * and can be asked for again.
 *
 * **Revoking.** A quieter version of the same argument. There is no `apiKey` entity in the
 * store, so there is no optimistic patch for the outbox to protect; and the entire point of
 * pressing revoke is that the credential stops working, so a revoke sitting silently in a
 * queue is worse than a failure the user can see and retry. Somebody who has just pasted a
 * key into a public repository needs the answer, not the promise of one.
 *
 * Nothing here logs a token, and nothing returns one except `createApiKey`, whose caller
 * holds it in component state for as long as the dialog is open and then drops it. Note that
 * the token is kept off every error path too: a caller that logged a failure would otherwise
 * be logging a live credential.
 */

import type { UUID } from '~/store';
import { gql } from '~/sync/api';
import { CREATE_API_KEY, REVOKE_API_KEY } from './operations';

/**
 * The scopes the server accepts. There are three, and inventing a fourth here would produce a
 * key the server refuses rather than a key that does less.
 *
 * They are coarse on purpose — one per thing somebody would recognise when answering "what
 * can this integration do", not one per resolver. A vocabulary fine enough to need a
 * reference page is one nobody sets correctly, and a scope set wrongly is either a broken
 * integration or a key with more reach than intended.
 *
 * The rule underneath all three: a scope can only ever take something away. There is
 * deliberately no scope that grants a key anything its owner does not already have, so a key
 * is at most a session belonging to the person who made it.
 */
export type ApiKeyScope = 'read' | 'write' | 'admin';

export interface ApiKeyScopeOption {
  readonly value: ApiKeyScope;
  /** The word on the checkbox. */
  readonly label: string;
  /** What choosing it actually permits, in a sentence somebody can act on. */
  readonly detail: string;
}

/** In the order they widen, which is the order somebody reads them in to decide. */
export const API_KEY_SCOPES: readonly ApiKeyScopeOption[] = [
  {
    value: 'read',
    label: 'Read',
    detail: 'Every read you could make yourself, and nothing that changes anything.',
  },
  {
    value: 'write',
    label: 'Write',
    detail:
      'The mutations as well. Read comes with it — the server expands the pair when the key is made, so the list above always shows what the key can really do.',
  },
  {
    value: 'admin',
    label: 'Admin',
    detail: 'Nothing is narrowed: exactly what you can do, and never anything more.',
  },
];

/** A key as a listing may hold it: metadata, and never the token. */
export interface ApiKeySummary {
  readonly id: UUID;
  readonly userId: UUID;
  readonly name: string;
  /** The token's leading characters — enough to recognise a key, not enough to use one. */
  readonly prefix: string;
  /** Empty means the key is not narrowed at all: everything its owner can do. */
  readonly scopes: readonly string[];
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

/**
 * A key and its one-time token, held only for as long as it is on screen.
 *
 * Deliberately not stored, not put in a URL and not written to the outbox. The caller keeps
 * it in component state and navigating away is what destroys it, which is the intended
 * lifetime rather than a limitation to work around.
 */
export interface CreatedApiKey {
  readonly key: ApiKeySummary;
  readonly token: string;
}

export interface NewApiKey {
  readonly name: string;
  /** Empty narrows nothing, which is what the server reads an empty set as. */
  readonly scopes: readonly string[];
  /** RFC 3339, or absent for a key that does not expire. */
  readonly expiresAt?: string | undefined;
}

/**
 * What a key is right now.
 *
 * Three states rather than a boolean, because a key that has quietly reached its expiry date
 * and a key somebody revoked in a hurry look identical if you only ask whether it works —
 * and they call for opposite reactions. Expiry is computed here rather than read off the
 * server because the server's answer would go stale on a settings screen left open, and the
 * only thing that changes it is the clock.
 */
export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

export function apiKeyStatus(key: ApiKeySummary, now: number = Date.now()): ApiKeyStatus {
  if (key.revokedAt !== null) return 'revoked';
  if (key.expiresAt === null) return 'active';
  const at = Date.parse(key.expiresAt);
  // An unparseable date reads as "does not expire" rather than as "expired": telling somebody
  // a working key is dead is the more expensive of the two mistakes.
  return Number.isNaN(at) || at > now ? 'active' : 'expired';
}

/**
 * What revoking this key costs, in the words the confirmation uses.
 *
 * "Are you sure?" is a question nobody can answer, and here the thing worth knowing is
 * specific: revocation takes effect on the next request, it cannot be undone, and whatever
 * was holding the token has to be given a different one by hand. Naming the key and its
 * prefix matters too — this is the sentence somebody reads to check they are about to break
 * the staging bot rather than the one deploying production.
 */
export function revocationConsequence(key: ApiKeySummary): string {
  return `Anything authenticating as ${key.name} (${key.prefix}…) stops working on its very next request — scripts, CI jobs and integrations holding this token will start being turned away. It cannot be undone: a replacement is a new key with a new token, which has to be pasted everywhere this one was used. Nothing this key created is affected; the issues and comments it wrote stay exactly as they are.`;
}

/**
 * Mints a key and returns its token, once.
 *
 * `scopes` is always sent, even empty, because omitting it and sending none mean the same
 * thing to the server and a caller should not have to know which one it chose.
 */
export async function createApiKey(input: NewApiKey): Promise<CreatedApiKey> {
  const data = await gql<{ createApiKey: { created: { token: string; apiKey: ApiKeySummary } } }>(
    CREATE_API_KEY,
    {
      input: {
        name: input.name,
        scopes: [...input.scopes],
        ...(input.expiresAt === undefined ? null : { expiresAt: input.expiresAt }),
      },
    },
  );
  // Unwrapped from `created` here so that one place in the client knows the shape of this
  // reply. The nesting is the server keeping the token off `ApiKey`; it is not something
  // every call site should have to remember.
  const created = data.createApiKey.created;
  return { key: created.apiKey, token: created.token };
}

/**
 * Retires one of your own keys.
 *
 * Somebody else's id answers exactly as an invented one does — not found rather than
 * forbidden — because the alternative turns a colleague's key id into a way of confirming it
 * exists. The caller refetches the list afterwards; the row does not disappear, it comes back
 * marked revoked, which is what an audit of "when did this stop working" needs.
 */
export async function revokeApiKey(id: UUID): Promise<void> {
  await gql(REVOKE_API_KEY, { id });
}
