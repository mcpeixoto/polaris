export const PROJECT_TEMPLATE_FIELDS = /* GraphQL */ `
  fragment ProjectTemplateFields on ProjectTemplate {
    id
    workspaceId
    teamId
    name
    description
    summary
    body
    properties
    position
    createdBy
    createdAt
    updatedAt
    archivedAt
  }
`;

export const PROJECT_TEMPLATE_MILESTONE_FIELDS = /* GraphQL */ `
  fragment ProjectTemplateMilestoneFields on ProjectTemplateMilestone {
    id
    workspaceId
    projectTemplateId
    name
    description
    targetDate
    sortOrder
    createdAt
    updatedAt
  }
`;

export const PROJECT_TEMPLATE_ISSUE_FIELDS = /* GraphQL */ `
  fragment ProjectTemplateIssueFields on ProjectTemplateIssue {
    id
    workspaceId
    projectTemplateId
    parentId
    title
    description
    properties
    sortOrder
    createdAt
    updatedAt
  }
`;

export const CREATE_PROJECT_TEMPLATE = /* GraphQL */ `
  ${PROJECT_TEMPLATE_FIELDS}
  mutation CreateProjectTemplate(
    $input: CreateProjectTemplateInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createProjectTemplate(input: $input, clientId: $clientId, opId: $opId) {
      version
      template {
        ...ProjectTemplateFields
      }
    }
  }
`;

export const UPDATE_PROJECT_TEMPLATE = /* GraphQL */ `
  ${PROJECT_TEMPLATE_FIELDS}
  mutation UpdateProjectTemplate($input: UpdateProjectTemplateInput!) {
    updateProjectTemplate(input: $input) {
      version
      template {
        ...ProjectTemplateFields
      }
    }
  }
`;

export const ARCHIVE_PROJECT_TEMPLATE = /* GraphQL */ `
  mutation ArchiveProjectTemplate($id: UUID!, $archived: Boolean!) {
    archiveProjectTemplate(id: $id, archived: $archived) {
      version
      id
    }
  }
`;

export const CREATE_PROJECT_TEMPLATE_MILESTONE = /* GraphQL */ `
  ${PROJECT_TEMPLATE_MILESTONE_FIELDS}
  mutation CreateProjectTemplateMilestone(
    $input: CreateProjectTemplateMilestoneInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createProjectTemplateMilestone(input: $input, clientId: $clientId, opId: $opId) {
      version
      milestone {
        ...ProjectTemplateMilestoneFields
      }
    }
  }
`;

export const UPDATE_PROJECT_TEMPLATE_MILESTONE = /* GraphQL */ `
  ${PROJECT_TEMPLATE_MILESTONE_FIELDS}
  mutation UpdateProjectTemplateMilestone($input: UpdateProjectTemplateMilestoneInput!) {
    updateProjectTemplateMilestone(input: $input) {
      version
      milestone {
        ...ProjectTemplateMilestoneFields
      }
    }
  }
`;

export const DELETE_PROJECT_TEMPLATE_MILESTONE = /* GraphQL */ `
  mutation DeleteProjectTemplateMilestone($id: UUID!) {
    deleteProjectTemplateMilestone(id: $id) {
      version
      id
    }
  }
`;

export const CREATE_PROJECT_TEMPLATE_ISSUE = /* GraphQL */ `
  ${PROJECT_TEMPLATE_ISSUE_FIELDS}
  mutation CreateProjectTemplateIssue(
    $input: CreateProjectTemplateIssueInput!
    $clientId: UUID!
    $opId: UUID!
  ) {
    createProjectTemplateIssue(input: $input, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...ProjectTemplateIssueFields
      }
    }
  }
`;

export const UPDATE_PROJECT_TEMPLATE_ISSUE = /* GraphQL */ `
  ${PROJECT_TEMPLATE_ISSUE_FIELDS}
  mutation UpdateProjectTemplateIssue($input: UpdateProjectTemplateIssueInput!) {
    updateProjectTemplateIssue(input: $input) {
      version
      issue {
        ...ProjectTemplateIssueFields
      }
    }
  }
`;

export const DELETE_PROJECT_TEMPLATE_ISSUE = /* GraphQL */ `
  mutation DeleteProjectTemplateIssue($id: UUID!) {
    deleteProjectTemplateIssue(id: $id) {
      version
      id
    }
  }
`;
