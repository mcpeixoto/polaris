# Form templates v1 (3.17)

**Status:** shipped on main  
**Migration:** `000042`  
**Client schema:** 19

Structured intake templates with configurable fields, replicated to the client, and provenance on issues via `formTemplateId`.

## Scope

- `form_template` and `form_template_field` entities (workspace or team scoped, same rules as standard templates)
- Field types: text, long_text, dropdown, checkboxes, date, file_upload, instructions, label_group, priority, title, due_date
- CRUD for templates and fields; archive retires template and drops fields from replicas
- `issue.form_template_id` for reporting/filtering
- Settings: Form tab on `/settings/templates`
- Create issue: form template picker + field fill; answers land in description (property-bound fields map to title/priority)

## Deferred

- Default templates (3.18), recurring (3.19), Slack/Asks integrations, label_group picker UI, file upload storage

## Reserved migration numbers (other branches)

- `000036`–`000038`: GitHub (feat/github-v1)
- `000039`: recurring templates
- `000040`: nav-drafts
