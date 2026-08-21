/**
 * Authorised third-party apps for this person in this workspace.
 *
 * Same reason as sessions: these are not replica data. Tokens never appear on the type.
 */

export const AUTHORISED_OAUTH_APP_FIELDS = /* GraphQL */ `
  fragment AuthorisedOauthAppFields on AuthorisedOauthApp {
    id
    name
    clientId
    imageUrl
    developer
    scopes
    lastUsedAt
    createdAt
  }
`;

export const AUTHORISED_OAUTH_APPS_QUERY = /* GraphQL */ `
  ${AUTHORISED_OAUTH_APP_FIELDS}
  query AuthorisedOauthApps {
    authorisedOauthApps {
      ...AuthorisedOauthAppFields
    }
  }
`;

export const REVOKE_AUTHORISED_OAUTH_APP = /* GraphQL */ `
  mutation RevokeAuthorisedOauthApp($id: UUID!) {
    revokeAuthorisedOauthApp(id: $id) {
      version
      id
    }
  }
`;

export const LEAVE_WORKSPACE = /* GraphQL */ `
  mutation LeaveWorkspace {
    leaveWorkspace {
      version
      id
    }
  }
`;
