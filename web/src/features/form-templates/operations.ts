export const FORM_TEMPLATE_FIELDS = /* GraphQL */ `
  fragment FormTemplateFields on FormTemplate {
    id
    workspaceId
    teamId
    name
    description
    properties
    position
    createdBy
    createdAt
    updatedAt
    archivedAt
  }
`;

export const FORM_TEMPLATE_FIELD_FIELDS = /* GraphQL */ `
  fragment FormTemplateFieldFields on FormTemplateField {
    id
    workspaceId
    formTemplateId
    fieldType
    label
    description
    required
    sortOrder
    config
    createdAt
    updatedAt
  }
`;

export const CREATE_FORM_TEMPLATE = /* GraphQL */ `
  ${FORM_TEMPLATE_FIELDS}
  mutation CreateFormTemplate($input: CreateFormTemplateInput!, $clientId: UUID!, $opId: UUID!) {
    createFormTemplate(input: $input, clientId: $clientId, opId: $opId) {
      version
      template {
        ...FormTemplateFields
      }
    }
  }
`;

export const UPDATE_FORM_TEMPLATE = /* GraphQL */ `
  ${FORM_TEMPLATE_FIELDS}
  mutation UpdateFormTemplate($input: UpdateFormTemplateInput!) {
    updateFormTemplate(input: $input) {
      version
      template {
        ...FormTemplateFields
      }
    }
  }
`;

export const ARCHIVE_FORM_TEMPLATE = /* GraphQL */ `
  mutation ArchiveFormTemplate($id: UUID!, $archived: Boolean!) {
    archiveFormTemplate(id: $id, archived: $archived) {
      version
      id
    }
  }
`;

export const CREATE_FORM_TEMPLATE_FIELD = /* GraphQL */ `
  ${FORM_TEMPLATE_FIELD_FIELDS}
  mutation CreateFormTemplateField(
    $input: CreateFormTemplateFieldInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createFormTemplateField(input: $input, clientId: $clientId, opId: $opId) {
      version
      field {
        ...FormTemplateFieldFields
      }
    }
  }
`;

export const UPDATE_FORM_TEMPLATE_FIELD = /* GraphQL */ `
  ${FORM_TEMPLATE_FIELD_FIELDS}
  mutation UpdateFormTemplateField($input: UpdateFormTemplateFieldInput!) {
    updateFormTemplateField(input: $input) {
      version
      field {
        ...FormTemplateFieldFields
      }
    }
  }
`;

export const DELETE_FORM_TEMPLATE_FIELD = /* GraphQL */ `
  mutation DeleteFormTemplateField($id: UUID!) {
    deleteFormTemplateField(id: $id) {
      version
      id
    }
  }
`;
