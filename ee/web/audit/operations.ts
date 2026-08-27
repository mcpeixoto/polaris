// COMMERCIALLY LICENSED — see ../../LICENSE. Not AGPL.
//
// The document lives beside the code that sends it, which is the convention every feature
// here follows: graphql-codegen scans the whole source tree, so a document's location is
// about readability rather than about being found.
//
// The operation is named `EnterpriseAuditLog` rather than `AuditLog`. Two documents sharing
// an operation name is a hard codegen error, and this tree is compiled into the same graph as
// web/src — where a future core-side document called `AuditLog` would be entirely reasonable
// to write. Naming it for the edition removes the collision before it can happen.

export const AUDIT_LOG_QUERY = /* GraphQL */ `
  query EnterpriseAuditLog($first: Int, $after: UUID) {
    auditLog(first: $first, after: $after) {
      id
      actorUserId
      actorType
      actorLabel
      action
      targetType
      targetId
      targetLabel
      ip
      userAgent
      createdAt
    }
  }
`;
