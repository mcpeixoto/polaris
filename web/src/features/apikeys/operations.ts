/**
 * The personal API key documents.
 *
 * They live here rather than in `~/gql/operations` for the reason every feature's documents
 * do — codegen scans `src/**` and a document belongs beside the code that sends it — but in
 * this feature the filing is load-bearing rather than tidy. These three documents are not one
 * path to the data among several; they are the *only* path. There is no `apiKey` entity in
 * the local store (see the note beside `EntityByType` in store/types), so nothing here feeds
 * a replica, nothing arrives later as a delta, and a screen that wants a current list has to
 * ask for one.
 *
 * `ApiKeyFields` is therefore a different kind of fragment from `LabelFields`. That one
 * mirrors the sync stream field for field, because an optimistic row and the delta that
 * replaces it must land in the store with identical shapes. This one mirrors nothing: it is
 * exactly the metadata one table draws, and the fields it does not select are fields no
 * screen has any use for.
 *
 * What it must never grow is a `token`. There is none on `ApiKey` to select — the server's
 * half of the same promise — because the plaintext token exists in the response to
 * `createApiKey` and nowhere else in the world, the database holding only its SHA-256.
 */

/**
 * A key as a listing may hold it: enough to say which key is which, and nothing that could
 * authenticate as one.
 *
 * `prefix` is the interesting field. It is the token's leading characters — the `plk_` marker
 * plus eight more — which is what lets somebody match a row here against a key pasted into a
 * CI configuration without the row being a credential itself. It reveals 48 of the token's
 * 256 bits and leaves 208, so it is a label rather than a shortcut.
 */
export const API_KEY_FIELDS = /* GraphQL */ `
  fragment ApiKeyFields on ApiKey {
    id
    userId
    name
    prefix
    scopes
    lastUsedAt
    expiresAt
    revokedAt
    createdAt
  }
`;

/**
 * The caller's own keys, and only ever those.
 *
 * It takes no user argument and there is no admin variant, which is the server's decision
 * rather than an omission: a workspace-wide listing of everybody's keys would be a credential
 * inventory — every long-lived access path in the organisation on one screen — and nothing in
 * the product needs one. Revoked and expired keys come back too, because somebody auditing
 * wants to see that a key was retired, not to find that it silently vanished.
 */
export const API_KEYS_QUERY = /* GraphQL */ `
  ${API_KEY_FIELDS}
  query ApiKeys {
    apiKeys {
      ...ApiKeyFields
    }
  }
`;

/**
 * Minting a key, and the one moment its token exists outside the caller's own storage.
 *
 * Note the nesting: the token and the key are selected through `created`, not off the payload
 * itself. That is deliberate on the server's side — the token is not a field of `ApiKey`, so
 * it cannot be selected into a listing by accident, and a `created` wrapper is what keeps the
 * two apart in the type system as well as in prose.
 */
export const CREATE_API_KEY = /* GraphQL */ `
  ${API_KEY_FIELDS}
  mutation CreateApiKey($input: CreateApiKeyInput!) {
    createApiKey(input: $input) {
      version
      created {
        token
        apiKey {
          ...ApiKeyFields
        }
      }
    }
  }
`;

/**
 * Retiring a key.
 *
 * It carries no `clientId`/`opId` pair, and unlike the label mutations that is not because
 * the call cannot be replayed — it is because it must not be queued. See the note in
 * `mutations.ts`: the point of pressing revoke is that the credential stops working now, and
 * a revoke sitting in an outbox is a key its owner believes is dead.
 */
export const REVOKE_API_KEY = /* GraphQL */ `
  mutation RevokeApiKey($id: UUID!) {
    revokeApiKey(id: $id) {
      version
      id
    }
  }
`;
