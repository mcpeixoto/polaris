/**
 * OAuth application documents. Not replicated — same reason as API keys — so these queries
 * are the only read path, and they must never select `clientSecret`.
 */

export const OAUTH_CLIENT_FIELDS = /* GraphQL */ `
  fragment OauthClientFields on OauthClient {
    id
    workspaceId
    creatorId
    clientId
    name
    description
    developer
    developerUrl
    imageUrl
    redirectUris
    allowedScopes
    publicEnabled
    clientCredentialsEnabled
    webhookUrl
    createdAt
    updatedAt
  }
`;

export const OAUTH_CLIENTS_QUERY = /* GraphQL */ `
  ${OAUTH_CLIENT_FIELDS}
  query OauthClients {
    oauthClients {
      ...OauthClientFields
    }
  }
`;

export const OAUTH_CLIENT_INFO_QUERY = /* GraphQL */ `
  query OauthClientInfo($clientId: String!) {
    oauthClientInfo(clientId: $clientId) {
      clientId
      name
      description
      developer
      developerUrl
      imageUrl
      allowedScopes
    }
  }
`;

export const CREATE_OAUTH_CLIENT = /* GraphQL */ `
  ${OAUTH_CLIENT_FIELDS}
  mutation CreateOauthClient($input: CreateOauthClientInput!) {
    createOauthClient(input: $input) {
      version
      created {
        clientSecret
        oauthClient {
          ...OauthClientFields
        }
      }
    }
  }
`;

export const UPDATE_OAUTH_CLIENT = /* GraphQL */ `
  ${OAUTH_CLIENT_FIELDS}
  mutation UpdateOauthClient($input: UpdateOauthClientInput!) {
    updateOauthClient(input: $input) {
      version
      oauthClient {
        ...OauthClientFields
      }
    }
  }
`;

export const ROTATE_OAUTH_SECRET = /* GraphQL */ `
  ${OAUTH_CLIENT_FIELDS}
  mutation RotateOauthClientSecret($id: UUID!) {
    rotateOauthClientSecret(id: $id) {
      version
      clientSecret
      oauthClient {
        ...OauthClientFields
      }
    }
  }
`;

export const DELETE_OAUTH_CLIENT = /* GraphQL */ `
  mutation DeleteOauthClient($id: UUID!) {
    deleteOauthClient(id: $id) {
      version
      id
    }
  }
`;

export const CREATE_OAUTH_AUTHORIZATION = /* GraphQL */ `
  mutation CreateOauthAuthorization($input: CreateOauthAuthorizationInput!) {
    createOauthAuthorization(input: $input) {
      redirectUri
    }
  }
`;
