/**
 * Recognises a boot failure that a rebuilt replica would fix.
 *
 * IndexedDB reports a database that does not match the code opening it as a plain
 * DOMException, and the sentence it produces — "Failed to execute 'transaction' on
 * 'IDBDatabase': One of the specified object stores was not found." — describes a call,
 * not a situation. Retrying it does nothing: the database on disk is the problem, and it
 * is the same database on the next attempt. So the boot screen needs to tell these apart
 * from a network failure, where retrying is exactly right.
 *
 * Matched on the message rather than the error type because the failure crosses an await
 * and arrives as a string in the phase state, and because `NotFoundError` is the name of
 * the class for several unrelated things.
 */
const REPLICA_FAILURES = [
  'object stores was not found',
  'no objectstore named',
  'idbdatabase',
  'indexeddb',
  'quotaexceedederror',
  'the database connection is closing',
];

export function isReplicaFailureMessage(message: string): boolean {
  const lowered = message.toLowerCase();
  return REPLICA_FAILURES.some((needle) => lowered.includes(needle));
}
