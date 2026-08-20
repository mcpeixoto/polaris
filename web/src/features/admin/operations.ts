/**
 * The administration screens' GraphQL operations.
 *
 * They live here rather than in `gql/operations.ts` for a reason that is not filing: these
 * are the only documents in the client whose *responses* are the point. Everything else
 * either feeds the replica or confirms a write the screen has already drawn, and can be
 * replayed from the outbox without anybody losing anything. An invitation token and an API
 * key token exist in exactly one response each, are never stored in a form that can be read
 * back, and are gone the moment that response is dropped — see `mutations.ts`, which is why
 * those two do not go through `engine.mutate` at all.
 *
 * Nothing here selects a token into a listing. `Invite` and `ApiKey` have no token field on
 * the wire, which is the server's half of the same promise; the queries below take the
 * metadata that identifies a credential — a prefix, an expiry, a last use — and never
 * anything that would authenticate as one.
 */

import { ISSUE_FIELDS } from '~/gql/operations';

/**
 * What this workspace's plan permits.
 *
 * The workspace's own facts are selected alongside the matrix because the two have to agree:
 * a screen that read the plan from one response and the seat count from another can report a
 * workspace as full and under its limit in the same paragraph. See features/admin/entitlements
 * for what the client does when this query cannot be answered.
 */
export const ENTITLEMENTS_QUERY = /* GraphQL */ `
  query Entitlements {
    workspace {
      id
      name
      plan
      planExpiresAt
      planLapsedAt
      seatLimit
      entitlements {
        plan
        seatLimit
        seatsUsed
        teamLimit
        historyDays
        privateTeams
        subTeams
        multiLevelSubTeams
        customViews
        apiKeys
        sso
        auditLog
        slas
        slack
        lapsed
      }
    }
  }
`;

export const INVITES_QUERY = /* GraphQL */ `
  query Invites {
    invites {
      id
      email
      role
      invitedBy
      teamIds
      expiresAt
      createdAt
    }
  }
`;

/**
 * Creates an invitation and returns its one-time token.
 *
 * The token is what makes the link work, and the server keeps only its SHA-256 — so this
 * response is the only place it will ever exist. A caller that discards it has to invite the
 * person again, which is the intended outcome rather than a gap.
 */
export const INVITE_TO_WORKSPACE = /* GraphQL */ `
  mutation InviteToWorkspace($input: InviteInput!) {
    inviteToWorkspace(input: $input) {
      id
      email
      role
      expiresAt
      token
    }
  }
`;

export const REVOKE_INVITE = /* GraphQL */ `
  mutation RevokeInvite($id: UUID!) {
    revokeInvite(id: $id) {
      version
      id
    }
  }
`;

// The API-key documents used to live here, next to the invite ones, because both are
// administrative and neither is replicated. They now live in `features/apikeys/`, beside the
// screen that is the only thing that sends them — which is where this repository puts a
// feature's documents, and which matters more than the loose grouping by subject: two copies
// of `query ApiKeys` in `src/**` is a hard error from graphql-codegen, so the duplicate would
// have broken `pnpm codegen` for whoever ran it next rather than for whoever created it.

export const REMOVE_USER = /* GraphQL */ `
  mutation RemoveUser($userId: UUID!) {
    removeUser(userId: $userId) {
      version
      id
    }
  }
`;

/**
 * The recycle bin.
 *
 * A network read and not a store query, because a deleted issue is precisely what the replica
 * has thrown away: the server emits a delete for it, and the client keeps no residue by
 * design. Restoring one is therefore the only write in the product whose subject the client
 * does not hold when it is made.
 */
export const DELETED_ISSUES_QUERY = /* GraphQL */ `
  ${ISSUE_FIELDS}
  query DeletedIssues {
    deletedIssues {
      ...IssueFields
    }
  }
`;

export const RESTORE_ISSUE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation RestoreIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    restoreIssue(id: $id, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;
