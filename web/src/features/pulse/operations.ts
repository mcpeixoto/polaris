/**
 * Pulse feed GraphQL documents beside the code that sends them.
 */

export const PULSE_FEED_FIELDS = /* GraphQL */ `
  fragment PulseFeedFields on PulseFeed {
    id
    workspaceId
    userId
    name
    projectIds
    createdAt
    updatedAt
  }
`;

export const CREATE_PULSE_FEED = /* GraphQL */ `
  ${PULSE_FEED_FIELDS}
  mutation CreatePulseFeed($input: CreatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {
    createPulseFeed(input: $input, clientId: $clientId, opId: $opId) {
      version
      pulseFeed {
        ...PulseFeedFields
      }
    }
  }
`;

export const UPDATE_PULSE_FEED = /* GraphQL */ `
  ${PULSE_FEED_FIELDS}
  mutation UpdatePulseFeed($input: UpdatePulseFeedInput!, $clientId: UUID!, $opId: UUID!) {
    updatePulseFeed(input: $input, clientId: $clientId, opId: $opId) {
      version
      pulseFeed {
        ...PulseFeedFields
      }
    }
  }
`;

export const DELETE_PULSE_FEED = /* GraphQL */ `
  mutation DeletePulseFeed($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    deletePulseFeed(id: $id, clientId: $clientId, opId: $opId) {
      version
      id
    }
  }
`;
