import { CYCLE_FIELDS } from '~/gql/operations';

export const UPDATE_CYCLE = /* GraphQL */ `
  ${CYCLE_FIELDS}
  mutation UpdateCycle($input: UpdateCycleInput!, $clientId: UUID!, $opId: UUID!) {
    updateCycle(input: $input, clientId: $clientId, opId: $opId) {
      version
      cycle {
        ...CycleFields
      }
    }
  }
`;

export const START_CYCLE_TODAY = /* GraphQL */ `
  ${CYCLE_FIELDS}
  mutation StartCycleToday($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    startCycleToday(id: $id, clientId: $clientId, opId: $opId) {
      version
      cycle {
        ...CycleFields
      }
    }
  }
`;
