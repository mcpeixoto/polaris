package store

// AsFormTemplateRow converts any identically-shaped form-template query row.
func AsFormTemplateRow[
	T CreateFormTemplateRow | UpdateFormTemplateRow | GetFormTemplateRow |
		UnarchiveFormTemplateRow | ArchiveFormTemplateRow |
		ListFormTemplatesForTeamRow | ListFormTemplatesInWorkspaceRow |
		StreamFormTemplatesForBootstrapRow,
](r T) GetFormTemplateRow {
	return GetFormTemplateRow(r)
}
