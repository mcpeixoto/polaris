package store

// AsIssueRow converts any identically-shaped issue query row to GetIssueRow.
//
// sqlc emits a separate struct per query even when the column list is identical.
// Domain code treats GetIssueRow as the canonical read shape; this helper keeps
// the conversions in one place so a column added to the RETURNING list fails here
// rather than silently at every call site.
func AsIssueRow[
	T CreateIssueRow | UpdateIssueRow | GetIssueRow | GetIssueForUpdateRow |
		ListStaleOpenIssuesRow | ListStaleClosedIssuesRow |
		ListIssuesForProjectRow | ListChildIssuesRow |
		ListArchivedIssuesForTeamRow | ListIssuesForTeamRow |
		ListIssuesByIDsRow | ListMyIssuesRow | ListDeletedIssuesRow |
		ListChildIssuesForParentsRow |
		StreamIssuesForBootstrapRow | BulkUpdateIssuesRow |
		RestoreIssueRow | SetIssueSnoozeRow,
](r T) GetIssueRow {
	return GetIssueRow(r)
}

// IssueTableRow converts the sqlc table model to the canonical query row shape.
func IssueTableRow(i Issue) GetIssueRow {
	return GetIssueRow{
		ID: i.ID, WorkspaceID: i.WorkspaceID, TeamID: i.TeamID, Number: i.Number,
		Title: i.Title, Description: i.Description, StateID: i.StateID,
		AssigneeID: i.AssigneeID, CreatorID: i.CreatorID, Priority: i.Priority,
		SortOrder: i.SortOrder, StartedAt: i.StartedAt, CompletedAt: i.CompletedAt,
		CanceledAt: i.CanceledAt, ArchivedAt: i.ArchivedAt, DeletedAt: i.DeletedAt,
		CreatedAt: i.CreatedAt, UpdatedAt: i.UpdatedAt, Estimate: i.Estimate,
		DueDate: i.DueDate, DueDateSource: i.DueDateSource, ParentID: i.ParentID,
		SubIssueSortOrder: i.SubIssueSortOrder, TemplateID: i.TemplateID,
		FormTemplateID: i.FormTemplateID, DeletedBy: i.DeletedBy,
		ProjectID: i.ProjectID, ProjectMilestoneID: i.ProjectMilestoneID,
		CycleID: i.CycleID, SnoozedUntil: i.SnoozedUntil, AutoClosedAt: i.AutoClosedAt,
	}
}
