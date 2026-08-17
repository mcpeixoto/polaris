/**
 * The menu that chooses a template for a new issue.
 *
 * A controlled Menu and nothing else, in the mould of the three property pickers: it does not
 * own its trigger, it does not create anything, and it does not decide what a template means
 * — it reports the template the user chose and the create dialog turns that into a prefilled
 * form. That is what lets the same component sit in the create modal today and in a "file
 * from template" command later without either of them owning the list.
 *
 * **"No template" is an item, not the absence of one.** It leads the menu, ticked when
 * nothing is chosen, and choosing it hands back `null`. A picker whose only way back to a
 * blank form is Escape has made a template a trap: the user has already seen the title and
 * the body land in the fields, and the question they now have — how do I undo that — has to
 * have an answer in the same list that caused it.
 *
 * **What is offered is decided by the team.** That team's templates, plus the workspace's,
 * which are offered everywhere. A template belonging to another team is not merely useless
 * here — its status and its labels belong to that team, and filing an issue with them would
 * be refused — so it is not shown at all. A rule the user never meets is better than an error
 * message.
 *
 * The scope is not a heading. The server mints positions across the whole workspace precisely
 * so a team's templates and the workspace's interleave in one order somebody chose, and
 * splitting them under two headings here would throw that away to answer a question the
 * person filing an issue is not asking. Every workspace template carries the same trailing
 * marker instead — always, not only where two names collide, because a marker that comes and
 * goes depending on what else happens to be in the list is a marker nobody learns to read.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { IssueTemplate, Store, UUID } from '~/store';

import styles from './TemplatePicker.module.css';

/** The id of the "no template" row. A word rather than an id, because there is no id for none. */
const NO_TEMPLATE = 'no-template';

export interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the menu belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  /** The team the issue will be filed in. Its templates, plus the workspace's, are offered. */
  teamId: UUID;
  /** The template currently chosen, or `null` when none is. */
  value: UUID | null;
  /** The chosen template, or `null` when the user chose to use none. */
  onSelect: (template: IssueTemplate | null) => void;
}

export function TemplatePicker({
  open,
  onClose,
  trigger,
  placement,
  teamId,
  value,
  onSelect,
}: TemplatePickerProps) {
  const templates = useLiveQuery(
    (store) => templatesForTeam(store, teamId),
    // `team` is in the list because the offering depends on the team still existing: a team
    // retired while the dialog is open takes its templates with it, and a list that went on
    // offering them would file an issue nobody can see.
    ['issueTemplate', 'team'],
    [teamId],
  );

  const items: MenuNode[] = [
    {
      id: NO_TEMPLATE,
      label: 'No template',
      text: 'no template none blank empty',
      selected: value === null,
      onSelect: () => onSelect(null),
    },
    { kind: 'separator' },
    ...templates.map((template) => {
      const description = descriptionOf(template);
      return {
        id: template.id,
        label: (
          <>
            <span className={styles.name}>{template.name}</span>
            {description === null ? null : (
              <span className={styles.description}> — {description}</span>
            )}
          </>
        ),
        // Required, not an optimisation: Menu falls back to the label for filtering and
        // type-ahead only when the label is a string, and this one is markup. Both the name
        // and the description are in it, so "regression" finds the template whose description
        // mentions regressions as well as the one called Regression.
        text: `${template.name} ${description ?? ''}`,
        // The scope. It rides the trailing slot rather than the label because it is a
        // property of the template rather than part of its name.
        hint: template.teamId === undefined ? 'Every team' : undefined,
        selected: template.id === value,
        onSelect: () => onSelect(template),
      };
    }),
  ];

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Template"
      placement={placement}
      filterable
      filterPlaceholder="Template…"
      // Two different facts. A workspace with no templates at all is not a filter that
      // matched nothing, and telling somebody "no matches" would send them looking for text
      // they never typed.
      emptyLabel={templates.length === 0 ? 'No templates for this team yet' : 'No templates match'}
    />
  );
}

/**
 * The templates a team may file an issue from: its own, and the workspace's.
 *
 * Ordered by position, which for templates is minted across the whole workspace rather than
 * per scope — see `lastPosition` in this feature's mutations — so the two sets interleave in
 * one order somebody chose rather than in two orders concatenated. Name breaks ties, so a
 * list is never in an order that depends on insertion.
 *
 * A team that is not in the replica is offered nothing at all, including the workspace's
 * templates. That covers two real states rather than a hypothetical one: the create dialog
 * passes `''` while a workspace with no teams hydrates, and a team retired while the dialog
 * is open takes its create button with it. Offering a template in either case files an issue
 * into a team the server will refuse, and the refusal arrives on the issue the user was
 * writing rather than on the list that offered it.
 *
 * Archived templates are filtered out here as well as by the server. The server emits a
 * *delete* when a template is retired, so in practice the row has already left the replica
 * and this predicate never fires — but a bootstrap that has not caught up, or a snapshot
 * restored from IndexedDB, can still be holding one, and a retired template offered in a
 * create dialog is a write the server would refuse.
 */
export function templatesForTeam(store: Store, teamId: UUID): IssueTemplate[] {
  const team = store.get('team', teamId);
  if (team === undefined || team.archivedAt !== undefined || team.retiredAt !== undefined) {
    return [];
  }

  const offered: IssueTemplate[] = [];
  for (const template of store.issueTemplates.values()) {
    if (template.archivedAt !== undefined) continue;
    if (template.teamId !== undefined && template.teamId !== teamId) continue;
    offered.push(template);
  }
  return offered.sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : a.name.localeCompare(b.name),
  );
}

/**
 * A template's description, or null when it has none.
 *
 * Empty and absent are the same thing to every reader, and both occur: a template created
 * without a description has NULL in the column, while one whose description was cleared has
 * an empty string, because the server's update is a COALESCE and cannot reach NULL again.
 */
function descriptionOf(template: IssueTemplate): string | null {
  const text = (template.description ?? '').trim();
  return text === '' ? null : text;
}
