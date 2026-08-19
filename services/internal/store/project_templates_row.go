package store

// AsProjectTemplateRow converts any identically-shaped project-template query row.
func AsProjectTemplateRow[
	T CreateProjectTemplateRow | UpdateProjectTemplateRow | GetProjectTemplateRow |
		ArchiveProjectTemplateRow |
		ListProjectTemplatesForTeamRow | ListProjectTemplatesInWorkspaceRow |
		StreamProjectTemplatesForBootstrapRow,
](r T) GetProjectTemplateRow {
	return GetProjectTemplateRow(r)
}
