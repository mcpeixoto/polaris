# UI composition rules

This document is about the layer above the components, and it exists because that is the
layer where this product's interface is currently inconsistent.

The primitives are not the problem. `web/src/styles/tokens.css` is a two-tier system with a
semantic layer a theme can replace wholesale; `Button`, `Menu`, `Modal`, `EmptyState` and
`Field` each argue their own case in a header comment and mostly get it right. What is
missing is any written agreement about how a *screen* assembles them — and the absence
shows. The create-issue composer is the clearest specimen, so it is worth stating what an
audit of one dialog turned up, because every rule below is a generalisation of one of them:

- A title field asking for the unboxed `plain` surface, rendered with the full boxed focus
  ring anyway, because two rules of equal specificity were settled by bundle order.
- Eight sibling controls with every visible label suppressed, leaving a row that reads
  "No assignee · No priority · No project · No form" and names none of its own fields.
- Five of those eight bordered native selects, three of them borderless ghost buttons, so
  half the row looked like controls and half looked like static text.
- `flex: 0 1 14ch` on all eight, which wrapped raggedly and truncated an option mid-word.
- No value icons anywhere, in a product whose issue detail rail puts a `StateIcon`,
  `PriorityIcon` and `Avatar` on the equivalent triggers.
- A `.form :global(input)` rule intended for the title, silently restyling every other
  input in the subtree, including a date field and every form-template answer.

None of these is a taste dispute. Each is a screen contradicting either another screen or
its own stated intent. The rules below are the agreement that prevents that.

## Non-negotiables

These are not preferences, and a change that breaks one is a regression regardless of how
it looks.

**Semantic tokens only.** A component stylesheet may reference `--text-secondary` and may
not reference `--color-neutral-700`, and may never contain a literal colour. The primitive
ramps exist for the token file to build semantics out of. A component that reaches past the
semantic layer has hard-coded an assumption a custom theme cannot reach. The three standing
exceptions are documented in place — `Button`'s destructive red, `Field`'s error red and
`Avatar`'s identity ramp — and each carries its reasoning; do not add a fourth without
writing one.

**Never style outside your own subtree.** No `:global()` selector in a feature stylesheet
that matches a bare element (`input`, `button`, `a`, `select`). If a specific element needs
a specific treatment, give that element a class. A blanket descendant selector styles
children that do not exist yet, which is how a date picker ends up wearing a page title's
typography.

**Specificity, not stylesheet order.** When a variant class has to override a base class
that it `composes`, both class names land on the element at equal weight and the cascade
falls back to emission order — which is decided by the bundler, not by you. Write the
override as `.base.variant` so it wins on specificity. This is exactly the bug that boxed
the composer's title field.

**Focus is never removed, only relocated.** `:focus-visible` on anything button-like, so a
mouse click does not draw a ring; `:focus-within` on any field whose ring belongs to a box
around the real control. `outline: none` is legitimate only where another visible focus
affordance is drawn in the same rule.

**Layers come from tokens.** `--z-*`, never an integer. The scale already encodes that a
dropdown opens above a modal and a toast survives both.

**Motion is directional and bounded.** Entrances: `--duration-fast` with `--ease-out`.
Exits: `--duration-instant` with `--ease-in`, and `forwards` on the keyframes so the last
frame does not hand back full opacity. Nothing on the keyboard path exceeds
`--duration-fast`. Anything that animates position must have a `prefers-reduced-motion`
answer.

## Control anatomy

**Heights come from the ladder, and the ladder answers to the 32px issue row.**
`--control-height-md` (28px) is the default for a control inside a dense row or toolbar, and
it is also what `Input` and `Select` ship as their own height — so a form built from the
primitives is 28px throughout unless something overrides it, and that is the product's
density rather than an oversight. `--control-height-lg` (32px) is what a field grows to when
it is the content of the screen rather than a property of something else: `Input`'s `plain`
surface already takes it as a minimum, which is why a create-issue title is taller than the
selects beneath it. Do not raise a boxed field to 32px screen by screen — if the auth and
settings forms should be roomier than a dialog's property grid, that is one decision about
the primitive, taken once, not a local override repeated per view. `--control-height-sm`
(22px) is for a control nested inside another control. `--control-height-xs` (18px) is
never interactive — it is below a reliable hit target, and it exists for chips riding
inside a row.

**A picker trigger is bordered unless a label already boxes it in.** `variant="ghost"` is
correct when the trigger is full-width inside a labelled row — the issue detail rail, where
the label column and the row's own hover state supply the affordance. A trigger standing in
a horizontal group of siblings must be `variant="secondary"`, because with no border and no
label it is indistinguishable from static text. One group, one affordance: do not mix
bordered selects and borderless buttons in the same row.

**A trigger shows its value's icon.** If the value has a canonical glyph — `StateIcon` for a
workflow state (with the state's colour), `PriorityIcon` for a priority, `Avatar` for a
person, `LabelChip` for a label — the trigger renders it. The icon is what makes a property
row scannable without reading it, and a screen that omits it is strictly harder to use than
the detail rail is.

**A trigger never truncates its own value mid-word.** Size the container to the content or
give it a sensible minimum and let it wrap; `text-overflow: ellipsis` is acceptable for
user-supplied text (an issue title, a project name) and is not acceptable for a fixed set
of product strings you control, such as "Does not repeat".

## Labels

**Three or more sibling fields all get visible labels.** `hideLabel` is for a control whose
meaning is already unambiguous on screen: a single search box with a magnifier, a toolbar
button with a tooltip, a title field whose placeholder is its label. A group of property
fields is the case it is *not* for — a row of placeholder values names nothing, and the
person filling it in has to open each control to discover what it is.

**There are two label treatments, and which one applies depends on the surface.**

A *property* label — the name of one field in a dense metadata row or rail, where the label
is repeated furniture and the value is what the eye is hunting for — is `--font-size-sm`,
`--text-tertiary`. The detail rail's `.propertyLabel` is the reference implementation, and
the create-issue composer's property grid follows it.

A *form* label — a settings screen, an auth screen, a dialog whose fields are the content
rather than metadata about content — uses `Field`'s own `.label`: `--font-size-sm`,
`--text-secondary`, `--font-weight-medium`. Do not hand-roll it; let `Field` draw it.

These genuinely differ, and the difference is not drift: a property rail is scanned for its
values, so the labels recede; a form is read a line at a time, so the labels lead. What is
forbidden is mixing the two treatments inside one group.

**`hideLabel` still renders the label to the accessibility tree.** Never reach for
`display: none` or `visibility: hidden`, and never drop the label element to "clean up"
markup. A dense surface drops the visible label; it never drops the name.

## Forms and dialogs

- Fields go in a grid with equal columns, not a wrapping flex row with a character-width
  basis. A grid cannot wrap raggedly and cannot truncate a cell it sized itself.
- Collapse the grid at narrow widths — three columns to two to one — rather than letting
  cells shrink below their content.
- A dialog reads top to bottom as document first, properties second, messages third,
  actions last. Do not interleave.
- Error and status messages use `Field`'s message treatment or the same tokens, are
  `role="alert"` for errors and `role="status"` for confirmations, and appear adjacent to
  what they describe.
- A footer has one primary action, at most one secondary, and demotes cancel to
  `variant="ghost"`. Two equal-weight neutral buttons beside a primary is three competing
  claims about what Enter does.
- The primary action is the same command the keyboard shortcut runs. If ⌘⏎ submits, the
  primary button submits.

## Menus and pickers

- Every menu item that can be reached by typing must have matchable text: `label` when it
  is a string, an explicit `text` when the label is markup. An item that cannot be typed to
  is unreachable in a keyboard-first product.
- A picker is controlled, does not own its trigger, and does not perform the write — it
  reports a chosen value. See `features/issue/pickers.tsx` for the contract.
- Selection is marked with a tick and announced, never by colour alone.
- Native `<select>` is right for a plain form value — it brings platform type-ahead, the
  mobile wheel, and needs no focus trap inside a dialog that already has one. `Menu` is
  right where the choice is a command with a shortcut and a filter, or where the list needs
  ranking or search. Whichever a surface picks, it picks one for the whole group.

## Empty, loading and error states

- A list with nothing in it renders `EmptyState`, never a blank pane — in a local-first
  client a blank pane is indistinguishable from data still arriving.
- Title says what is not there in a few words; description is one sentence; the action is
  the same command the shortcut would run.
- A failed load says what failed and offers a retry. "Something went wrong" with no action
  is a dead end.

## Colour and meaning

- Colour is never the only carrier of meaning. Every tone puts its word in the text as
  well — an overdue date says "overdue", it is not merely red. This binds links too: a link
  distinguished from surrounding prose by colour alone needs 3:1 against that prose, which
  the accent does not have in either theme, so a link inside a sentence is underlined.
- **`--text-tertiary` is only safe on `--bg-primary`.** In dark it is neutral-500, which
  clears 4.5:1 against the page by a tenth and then fails the moment the text lands on a
  raised surface — 4.08:1 on `--bg-elevated`, 3.38:1 on `--bg-tertiary`. Body text on a card,
  a menu, a dialog or a popover takes `--text-secondary`. Tertiary keeps the surfaces it was
  measured for: the page itself, icons at the 3:1 floor, and disabled text, which is exempt.
  This one rule has already been hit independently in `Kbd`, `Menu`, `Modal`, `LabelChip` and
  every auth screen; it is the single most repeated contrast defect in the codebase.
- Priority uses the priority ramp, workflow state uses the state tokens, relation flags use
  the relation tokens. Do not borrow across the three: a theme that recolours urgency must
  not silently recolour "blocked".

## Copy

Sentence case everywhere — buttons, labels, headings, menu items. No trailing period on a
label or a button. Buttons are verbs and name their outcome ("Create issue", "Save as
draft"), never "OK" or "Submit". Numbers in prose read as prose ("Filed 1 issue"), not as a
machine's output.

## Accessibility floor

Every interactive element is reachable and operable from the keyboard; every icon-only
control has an accessible name; every dialog traps focus and returns it to the trigger on
close; every field's error is wired through `aria-describedby` by the component, not by
hand at the call site; contrast clears 4.5:1 for body text in **both** themes.

Non-text contrast needs the distinction WCAG 1.4.11 actually draws, because reading it as
"every border clears 3:1" would repaint every hairline in the product. A border owes 3:1
when it is the *only* thing identifying that a control is there — an unchecked checkbox is
the canonical case, and `--border-control` exists for it. A border that separates two things
which are both already visible, or that outlines a control already announced by its own
label and text, is decorative, and `--border-subtle` and `--border-default` are deliberately
below the threshold. Icons that carry meaning on their own — a priority glyph, a status ring
— owe the full 3:1.

## Per-file checklist

Before considering a file done:

1. No literal colours, no `--color-*` primitives, no raw z-index integers.
2. No `:global()` bare-element selector.
3. Any `composes` override written as `.base.variant`, not left to emission order.
4. Focus visible on every interactive element, in both themes.
5. Sibling field groups have visible labels; icon-only controls have accessible names.
6. Property triggers carry their value's icon and one consistent affordance per group.
7. No truncated product strings; no ragged wrap.
8. Empty, loading and error states all exist and all say something actionable.
9. Entrance and exit motion follow the direction and duration rules, with a reduced-motion
   answer for anything that moves.
10. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm vite build` all pass. Tests may be
    added; an existing test may not be modified or deleted.
