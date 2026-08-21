# Template sub-issues and Aa placeholders

**Status:** shipped on this branch
**Migration:** `000072_template_sub_issues`
**Client schema:** 51 (50 reserved for initiative labels)

Standard issue templates can name children and mark description prompts the way Linear's
Aa toolbar does.

## Scope

- Settings → Templates: add titled sub-issues. Creating an issue from that template files
  them as children in the same team, inheriting priority, project and cycle. Labels are
  not inherited.
- Templates that name any sub-issues cannot be applied to a sub-issue — Linear does not
  offer them there, and the API refuses the same way.
- Aa: select text in the template description and press Aa to wrap it as `⟦prompt⟧`. The
  create dialog keeps those marks so the filer can type over them; remaining marks become
  the prompt text when the issue is filed.

## Deferred

- Nested templates on a sub-issue row
- Editing the child list inside the create dialog
- Recurring snapshots of template sub-issues
