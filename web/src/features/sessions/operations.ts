/**
 * The session documents.
 *
 * They live here rather than in `~/gql/operations` for the same reason the API-key
 * documents do: codegen scans `src/**`, and these are the only path to the data. There is
 * no `accountSession` entity in the local store — sessions belong to an account, not a
 * workspace, and replicating them would put a credential inventory in every device's
 * IndexedDB. A screen that wants a current list has to ask for one.
 *
 * `AccountSessionFields` must never grow a token. There is none on the type to select.
 */

export const ACCOUNT_SESSION_FIELDS = /* GraphQL */ `
  fragment AccountSessionFields on AccountSession {
    id
    label
    userAgent
    ip
    country
    current
    lastSeenAt
    createdAt
    expiresAt
  }
`;

export const ACCOUNT_SESSIONS_QUERY = /* GraphQL */ `
  ${ACCOUNT_SESSION_FIELDS}
  query AccountSessions {
    accountSessions {
      ...AccountSessionFields
    }
  }
`;

export const REVOKE_ACCOUNT_SESSION = /* GraphQL */ `
  mutation RevokeAccountSession($id: UUID!) {
    revokeAccountSession(id: $id) {
      version
      id
    }
  }
`;

export const REVOKE_OTHER_SESSIONS = /* GraphQL */ `
  mutation RevokeOtherSessions {
    revokeOtherSessions {
      version
      id
    }
  }
`;
