# Project templates v1 (5.11)

**Status:** shipped on main  
**Migration:** `000043`  
**Client schema:** 21

Prefilled project templates with milestones and starter issues, replicated to the client, and provenance on projects via `projectTemplateId`.

## Scope

- `project_template`, `project_template_milestone`, and `project_template_issue` entities (workspace or team scoped, same rules as standard templates)
- Template properties mirror `createProject`: status, priority, lead, colour, dates
- CRUD for templates, milestones, and starter issues; archive retires template and drops children from replicas
- `project.project_template_id` for reporting/filtering
- Settings: Project tab on `/settings/templates`
- Create project: template picker prefills name and summary; server applies milestones and issues

## Deferred

- Sub-issue hierarchy in template editor UI
- Initiative and member prefills from template properties
- Template application preview before create

## Reserved migration numbers (other branches)

- `000036`–`000038`: GitHub (feat/github-v1)
- `000039`: recurring templates
- `000040`: nav-drafts
