/**
 * The component gallery — a workbench for looking at the primitives, and nothing else.
 *
 * A design-polish pass needs somewhere it can see every state of every primitive at once,
 * and the product itself is a bad place to do that: reaching a loading Button, an invalid
 * Input and an empty Triage list means signing in, seeding a workspace, and then holding
 * three screens in the right state long enough to compare them. Half the states — a
 * disabled danger button, a hidden-label select — never appear together at all.
 *
 * So the one requirement this page has is the one that decides its whole shape: it must
 * render on a cold browser with no account, no server, no replica and no sync engine. That
 * is why it is reached before the router in App.tsx rather than declared as a Route — every
 * Route in this app sits inside Boot, and Boot's first act is to ask for a session. Nothing
 * below imports from ~/store, ~/sync or ~/hooks beyond what the primitives themselves pull
 * in, and the primitives pull in only `usePresence`, which is a plain hook with no context
 * behind it. There is consequently no stub provider here, because none is needed.
 *
 * It is development-only, and enforced at the import rather than by a check inside: see the
 * `import.meta.env.DEV` ternary in App.tsx, which lets Rollup drop this module and its
 * stylesheet out of a production build entirely.
 *
 * Every specimen is captioned, because the point of the page is that a screenshot of it can
 * be read by somebody who was not there when it was taken. Where a state cannot honestly be
 * drawn — focus, hover — the caption says how to reach it rather than the markup faking the
 * styling, which would make the page a drawing of the design system instead of a view of it.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  LabelChip,
  Logo,
  Menu,
  Modal,
  PriorityIcon,
  PRIORITY_LABELS,
  PRIORITY_LEVELS,
  Progress,
  Select,
  Spinner,
  StateIcon,
  STATE_LABELS,
  Textarea,
  Tooltip,
  useFieldIds,
  type AvatarSize,
  type BadgeTone,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonSize,
  type IconButtonVariant,
  type LogoSize,
  type MenuNode,
  type ModalSize,
  type SpinnerSize,
  type TooltipPlacement,
} from '~/components';
// The two primitives that live in components/ without being re-exported from its index,
// each because it has a single narrow caller. They are shared components with shared
// styling all the same, and a polish pass that could not see them would miss the most
// consequential dialog and the most consequential field in the product.
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { SecretField } from '~/components/SecretField';
import type { StateCategory } from '~/store/types';
import { applyTheme, getStoredTheme, type ThemeName } from '~/styles/theme';
import styles from './Gallery.module.css';

/* ------------------------------------------------------------------ *
 * Page furniture
 * ------------------------------------------------------------------ */

/**
 * A section, and the anchor the contents list jumps to.
 *
 * The id is derived from the title rather than passed separately so the two cannot drift:
 * a table of contents pointing at an anchor that was renamed is a dead link nobody notices
 * until they click it.
 */
function sectionId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function Section({
  title,
  note,
  wide = false,
  children,
}: {
  title: string;
  note?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} id={sectionId(title)}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {note === undefined ? null : <p className={styles.sectionNote}>{note}</p>}
      <div className={[styles.grid, wide ? styles.gridWide : null].filter(Boolean).join(' ')}>
        {children}
      </div>
    </section>
  );
}

/** One captioned specimen. `note` carries what the picture itself cannot say. */
function Cell({
  label,
  note,
  stack = false,
  canvas = false,
  children,
}: {
  label: string;
  note?: string;
  stack?: boolean;
  canvas?: boolean;
  children: ReactNode;
}) {
  const specimen = (
    <div
      className={[styles.specimen, stack ? styles.specimenStack : null].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
  return (
    <div className={styles.cell}>
      <span className={styles.cellLabel}>{label}</span>
      {note === undefined ? null : <span className={styles.cellNote}>{note}</span>}
      {canvas ? <div className={styles.canvas}>{specimen}</div> : specimen}
    </div>
  );
}

/* Three throwaway glyphs, so the icon slots have something in them. Deliberately plain. */

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Token swatches
 * ------------------------------------------------------------------ */

/**
 * The semantic groups, transcribed from the SEMANTICS block of styles/tokens.css in the
 * order they appear there.
 *
 * A list rather than a scrape of the stylesheet: the resolved *values* are read live from
 * the document below, which is the part that has to be true, and the names are the table of
 * contents for a file a person is about to open anyway. Primitives are deliberately absent
 * — a component that reaches for `--color-neutral-700` is a bug, and putting the ramp on
 * this page would suggest otherwise.
 */
const TOKEN_GROUPS: readonly { readonly title: string; readonly names: readonly string[] }[] = [
  {
    title: 'Backgrounds',
    names: [
      '--bg-primary',
      '--bg-secondary',
      '--bg-tertiary',
      '--bg-sidebar',
      '--bg-elevated',
      '--bg-hover',
      '--bg-selected',
      '--bg-overlay',
    ],
  },
  {
    title: 'Text',
    names: ['--text-primary', '--text-secondary', '--text-tertiary', '--text-inverse'],
  },
  {
    title: 'Borders',
    names: ['--border-subtle', '--border-default', '--border-strong', '--border-focus'],
  },
  {
    title: 'Accent',
    names: ['--accent', '--accent-hover', '--accent-subtle', '--accent-text', '--accent-contrast'],
  },
  {
    title: 'Comment marks',
    names: ['--comment-mark', '--comment-mark-resolved', '--comment-mark-active'],
  },
  {
    title: 'Priority',
    names: [
      '--priority-none',
      '--priority-low',
      '--priority-medium',
      '--priority-high',
      '--priority-urgent',
    ],
  },
  {
    title: 'State',
    names: [
      '--state-triage',
      '--state-backlog',
      '--state-unstarted',
      '--state-started',
      '--state-completed',
      '--state-canceled',
    ],
  },
  { title: 'Relations', names: ['--relation-blocked', '--relation-blocking'] },
];

const SHADOW_NAMES: readonly string[] = ['--shadow-sm', '--shadow-md', '--shadow-lg'];

/**
 * The resolved value of every token above, read off the document element.
 *
 * Recomputed whenever the theme attribute changes, because that is the whole reason the
 * values are read at runtime instead of transcribed: the point of the switch at the top of
 * the page is watching this table move.
 */
function useTokenValues(theme: ThemeName): Readonly<Record<string, string>> {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    const read: Record<string, string> = {};
    for (const group of TOKEN_GROUPS) {
      for (const name of group.names) read[name] = computed.getPropertyValue(name).trim();
    }
    for (const name of SHADOW_NAMES) read[name] = computed.getPropertyValue(name).trim();
    setValues(read);
    // `theme` is not read in the body — the attribute it wrote is, via getComputedStyle —
    // so it is here purely as the signal to look again.
  }, [theme]);

  return values;
}

function Tokens({ theme }: { theme: ThemeName }) {
  const values = useTokenValues(theme);

  return (
    <section className={styles.section} id={sectionId('Tokens')}>
      <h2 className={styles.sectionTitle}>Tokens</h2>
      <p className={styles.sectionNote}>
        The semantic layer, one row per group, with the value each name resolves to in the theme
        currently applied. These are the only colours a component stylesheet may ask for.
      </p>
      {TOKEN_GROUPS.map((group) => (
        <div className={styles.tokenGroup} key={group.title}>
          <h3 className={styles.tokenGroupTitle}>{group.title}</h3>
          <div className={styles.tokenRow}>
            {group.names.map((name) => (
              <div className={styles.tokenChip} key={name}>
                <span
                  className={styles.tokenSwatch}
                  style={{ backgroundColor: `var(${name})` }}
                  aria-hidden="true"
                />
                <span className={styles.tokenText}>
                  <span className={styles.tokenName}>{name}</span>
                  <span className={styles.tokenValue}>{values[name] ?? '…'}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className={styles.tokenGroup}>
        <h3 className={styles.tokenGroupTitle}>Elevation</h3>
        <div className={styles.tokenRow}>
          {SHADOW_NAMES.map((name) => (
            <div className={styles.tokenChip} key={name}>
              <span
                className={styles.shadowTile}
                style={{ boxShadow: `var(${name})` }}
                aria-hidden="true"
              />
              <span className={styles.tokenText}>
                <span className={styles.tokenName}>{name}</span>
                <span className={styles.tokenValue}>{values[name] ?? '…'}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Sections with local state
 * ------------------------------------------------------------------ */

const MENU_ITEMS: readonly MenuNode[] = [
  { kind: 'heading', label: 'Status' },
  {
    id: 'todo',
    label: 'Todo',
    icon: <StateIcon category="unstarted" decorative />,
    onSelect: () => {},
  },
  {
    id: 'progress',
    label: 'In Progress',
    icon: <StateIcon category="started" progress={0.5} decorative />,
    selected: true,
    onSelect: () => {},
  },
  {
    id: 'done',
    label: 'Done',
    icon: <StateIcon category="completed" decorative />,
    keys: 'mod+enter',
    onSelect: () => {},
  },
  { kind: 'separator' },
  { id: 'hint', label: 'Backlog', hint: '42', onSelect: () => {} },
  { id: 'disabled', label: 'Canceled', disabled: true, onSelect: () => {} },
  { id: 'danger', label: 'Delete issue', danger: true, icon: <TrashIcon />, onSelect: () => {} },
];

/**
 * Menu and Modal are portalled and only exist while open, so they cannot be laid out as a
 * static specimen — each one gets a trigger and a piece of local state, which is also how a
 * caller uses them. The gallery is the caller here, doing exactly what a screen does.
 */
function Menus() {
  const plainRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const emptyRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<'plain' | 'filter' | 'empty' | null>(null);

  return (
    <Section
      title="Menu"
      note="Portalled and open-on-demand. Items cover: heading, icon, selected, keys, hint, disabled, danger and separator. Arrow keys move the active item, type-ahead jumps, Escape closes and returns focus to the trigger."
      wide
    >
      <Cell label="items — every kind">
        <div className={styles.triggerRow}>
          <Button ref={plainRef} onClick={() => setOpen(open === 'plain' ? null : 'plain')}>
            Open menu
          </Button>
        </div>
        <Menu
          open={open === 'plain'}
          onClose={() => setOpen(null)}
          trigger={plainRef}
          items={MENU_ITEMS}
          label="Status"
        />
      </Cell>
      <Cell label="filterable — placement top-start">
        <div className={styles.triggerRow}>
          <Button ref={filterRef} onClick={() => setOpen(open === 'filter' ? null : 'filter')}>
            Open filterable
          </Button>
        </div>
        <Menu
          open={open === 'filter'}
          onClose={() => setOpen(null)}
          trigger={filterRef}
          items={MENU_ITEMS}
          label="Status"
          placement="top-start"
          filterable
          filterPlaceholder="Filter statuses…"
        />
      </Cell>
      <Cell label="empty — emptyLabel">
        <div className={styles.triggerRow}>
          <Button ref={emptyRef} onClick={() => setOpen(open === 'empty' ? null : 'empty')}>
            Open empty
          </Button>
        </div>
        <Menu
          open={open === 'empty'}
          onClose={() => setOpen(null)}
          trigger={emptyRef}
          items={[]}
          label="Assignee"
          emptyLabel="Nobody to assign"
        />
      </Cell>
    </Section>
  );
}

const MODAL_SIZES: readonly ModalSize[] = ['sm', 'md', 'lg'];

function Modals() {
  const [size, setSize] = useState<ModalSize | null>(null);
  const [withFooter, setWithFooter] = useState(false);

  return (
    <Section
      title="Modal"
      note="Portalled, focus-trapped, and closed by Escape, the close button or the backdrop. One at a time — each button below opens the same dialog at a different size."
      wide
    >
      {MODAL_SIZES.map((candidate) => (
        <Cell label={`size=${candidate}`} key={candidate}>
          <Button
            onClick={() => {
              setWithFooter(false);
              setSize(candidate);
            }}
          >
            Open {candidate}
          </Button>
        </Cell>
      ))}
      <Cell label="with description + footer">
        <Button
          onClick={() => {
            setWithFooter(true);
            setSize('md');
          }}
        >
          Open with footer
        </Button>
      </Cell>
      {size === null ? null : (
        <Modal
          open
          onClose={() => setSize(null)}
          title="Delete this issue?"
          size={size}
          description={withFooter ? 'This cannot be undone from here.' : undefined}
          footer={
            withFooter ? (
              <>
                <Button onClick={() => setSize(null)}>Cancel</Button>
                <Button variant="danger" onClick={() => setSize(null)}>
                  Delete
                </Button>
              </>
            ) : undefined
          }
        >
          <p>
            Body content. The dialog is {size}. Tab is trapped inside it, and Escape closes it and
            returns focus to the button that opened it.
          </p>
        </Modal>
      )}
    </Section>
  );
}

/**
 * Checkbox is the one primitive whose interesting states are only reachable by clicking,
 * so the gallery holds the state for it rather than pinning `checked` and producing a
 * control that cannot be tried.
 */
function Checkboxes() {
  const [checked, setChecked] = useState(true);

  return (
    <Section
      title="Checkbox"
      note="A real <input type=checkbox> painted over, so space, form participation and the announced change are the platform's."
    >
      <Cell label="unchecked">
        <Checkbox label="Unchecked" />
      </Cell>
      <Cell label="checked (live — click it)">
        <Checkbox
          label="Checked"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
      </Cell>
      <Cell label="indeterminate" note="A DOM property, never an attribute — set by the component.">
        <Checkbox label="Some of them" indeterminate />
      </Cell>
      <Cell label="disabled" note="Also shown checked: the two look different.">
        <Checkbox label="Disabled" disabled />
        <Checkbox label="Disabled, checked" disabled checked readOnly />
      </Cell>
      <Cell label="no label + aria-label" note="The select-all in a list header.">
        <Checkbox aria-label="Select all issues" />
      </Cell>
      <Cell
        label="focused"
        note="Not drawn. Tab to it — the ring is --border-focus at --focus-ring-width."
      >
        <Checkbox label="Tab here" />
      </Cell>
    </Section>
  );
}

/** Portalled like the Modal it is built on, so it gets triggers rather than static cells. */
function ConfirmDialogs() {
  const [open, setOpen] = useState<'plain' | 'destructive' | 'busy' | 'error' | null>(null);
  const close = () => setOpen(null);

  return (
    <Section
      title="ConfirmDialog"
      note="A Modal that cannot be constructed without saying what is about to change. Focus lands on Cancel, never on the destructive button."
      wide
    >
      <Cell label="default">
        <Button onClick={() => setOpen('plain')}>Open</Button>
      </Cell>
      <Cell label="destructive">
        <Button variant="danger" onClick={() => setOpen('destructive')}>
          Open destructive
        </Button>
      </Cell>
      <Cell
        label="busy"
        note="The confirm button is aria-disabled, not disabled — focus stays put."
      >
        <Button onClick={() => setOpen('busy')}>Open busy</Button>
      </Cell>
      <Cell label="error" note="The attempt was refused; the dialog stays open and says why.">
        <Button onClick={() => setOpen('error')}>Open with error</Button>
      </Cell>
      {open === null ? null : (
        <ConfirmDialog
          open
          title="Remove Ada Lovelace from Acme?"
          consequence="Ada loses access to this workspace and its 3 teams. Their issues and comments stay exactly as they are."
          confirmLabel="Remove Ada"
          destructive={open === 'destructive' || open === 'busy' || open === 'error'}
          busy={open === 'busy'}
          error={open === 'error' ? 'Only an admin can remove a member.' : undefined}
          onConfirm={close}
          onClose={close}
        />
      )}
    </Section>
  );
}

/** Textarea mirrors its value into the element rather than controlling it — see nativeValue. */
function Textareas() {
  const [text, setText] = useState('Typed text. The box grows to fit, up to maxRows.');

  return (
    <Section title="Textarea" note="Auto-growing between minRows and maxRows." wide>
      <Cell label="boxed, with label + hint" stack>
        <Textarea
          label="Description"
          hint="Markdown is supported."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Cell>
      <Cell label="boxed, error" stack>
        <Textarea label="Description" error="Say something about the issue." value="" />
      </Cell>
      <Cell label="plain surface" stack canvas>
        <Textarea
          surface="plain"
          label="Description"
          hideLabel
          placeholder="Write a description…"
        />
      </Cell>
      <Cell
        label="plain, focused"
        note="Not drawn. Click or Tab in — a single bottom edge in --border-focus, no ring and no box, matching Input's plain surface. Until this pass the plain textarea removed its outline and drew nothing in its place."
        stack
        canvas
      >
        <Textarea surface="plain" label="Description" hideLabel placeholder="Tab here" />
      </Cell>
      <Cell
        label="plain, error"
        note="The same single edge in --priority-urgent. A red box round a field that has no box would undo the variant; the message underneath is what names the problem."
        stack
        canvas
      >
        <Textarea
          surface="plain"
          label="Description"
          hideLabel
          error="Say something about the issue."
          value=""
        />
      </Cell>
      <Cell label="hideLabel + placeholder" stack>
        <Textarea label="Comment" hideLabel placeholder="Leave a comment…" />
      </Cell>
      <Cell label="minRows=4 maxRows=6" stack>
        <Textarea label="Notes" minRows={4} maxRows={6} placeholder="Four lines at rest…" />
      </Cell>
      <Cell label="disabled" stack>
        <Textarea label="Description" disabled value="Cannot be edited." />
      </Cell>
      <Cell label="readOnly" stack>
        <Textarea label="Description" readOnly value="Readable, not editable." />
      </Cell>
      <Cell label="focused" note="Not drawn. Click or Tab in — the box takes --border-focus." stack>
        <Textarea label="Focus me" placeholder="Tab here" />
      </Cell>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md'];
const ICON_BUTTON_VARIANTS: readonly IconButtonVariant[] = ['ghost', 'secondary', 'danger'];
const ICON_BUTTON_SIZES: readonly IconButtonSize[] = ['sm', 'md'];
const AVATAR_SIZES: readonly AvatarSize[] = ['xs', 'sm', 'md'];
const BADGE_TONES: readonly BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];
const LOGO_SIZES: readonly LogoSize[] = ['sm', 'md', 'lg'];
const SPINNER_SIZES: readonly SpinnerSize[] = ['sm', 'md'];
const TOOLTIP_PLACEMENTS: readonly TooltipPlacement[] = ['top', 'bottom', 'left', 'right'];
const STATE_CATEGORIES: readonly StateCategory[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'duplicate',
];

const THEMES: readonly ThemeName[] = ['light', 'dark', 'system'];

/** Every section title, in render order, for the sticky contents strip. */
const CONTENTS: readonly string[] = [
  'Tokens',
  'Avatar',
  'Badge',
  'Button',
  'Checkbox',
  'ConfirmDialog',
  'EmptyState',
  'Field',
  'IconButton',
  'Input',
  'Kbd',
  'LabelChip',
  'Logo',
  'Menu',
  'Modal',
  'PriorityIcon',
  'Progress',
  'SecretField',
  'Select',
  'Spinner',
  'StateIcon',
  'Textarea',
  'Tooltip',
];

export function Gallery() {
  // The theme switch writes through applyTheme, which is also what persists it. That is the
  // module's contract and not worth working around: this page is development-only, and a
  // developer who flipped the gallery to light almost certainly wants the app in light too.
  const [theme, setTheme] = useState<ThemeName>(() => getStoredTheme());
  const fieldIds = useFieldIds(`${useId()}-raw`);

  const chooseTheme = (next: ThemeName) => {
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>Component gallery</h1>
          <p className={styles.headerNote}>
            Development only, unauthenticated, and mounted before the router — no session, no
            replica, no sync engine. Every shared primitive, in every state its props allow.
          </p>
        </div>
        <div className={styles.headerControls}>
          <span className={styles.headerControlsLabel}>Theme</span>
          {THEMES.map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={theme === candidate ? 'primary' : 'secondary'}
              aria-pressed={theme === candidate}
              onClick={() => chooseTheme(candidate)}
            >
              {candidate}
            </Button>
          ))}
        </div>
      </header>

      <nav className={styles.contents} aria-label="Sections">
        {CONTENTS.map((title) => (
          <a className={styles.contentsLink} href={`#${sectionId(title)}`} key={title}>
            {title}
          </a>
        ))}
      </nav>

      <Tokens theme={theme} />

      <Section
        title="Avatar"
        note="Initials are the normal case, not a fallback. The hue is a hash of the colour key, so it is stable across reloads and machines."
      >
        {AVATAR_SIZES.map((size) => (
          <Cell label={`size=${size}`} key={size}>
            <Avatar name="Ada Lovelace" size={size} />
            <Avatar name="Grace Hopper" size={size} />
            <Avatar name="Alan Turing" size={size} />
          </Cell>
        ))}
        <Cell label="one word / no letters" note="xs drops to a single initial by design.">
          <Avatar name="Cher" />
          <Avatar name="  " />
          <Avatar name="Cher" size="xs" />
        </Cell>
        <Cell label="src" note="A broken URL falls back to initials, keyed on the URL.">
          <Avatar name="Ada Lovelace" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
          <Avatar name="Ada Lovelace" src="/does-not-exist.png" />
        </Cell>
        <Cell label="colorKey" note="Same name, different key — the hue moves, which is the point.">
          <Avatar name="Ada Lovelace" colorKey="user-1" />
          <Avatar name="Ada Lovelace" colorKey="user-2" />
          <Avatar name="Ada Lovelace" colorKey="user-3" />
        </Cell>
        <Cell label="decorative" note="No role, no name — for use beside the written name.">
          <Avatar name="Ada Lovelace" decorative /> Ada Lovelace
        </Cell>
      </Section>

      <Section
        title="Badge"
        note="A standing fact about a row. Never clickable — the tone is a claim about meaning, and the text always says what the colour does."
      >
        {BADGE_TONES.map((tone) => (
          <Cell label={`tone=${tone}`} key={tone}>
            <Badge tone={tone}>{tone}</Badge>
            <Badge tone={tone} icon={<PlusIcon />}>
              with icon
            </Badge>
          </Cell>
        ))}
        <Cell label="default (tone omitted)">
          <Badge>Neutral by default</Badge>
        </Cell>
        <Cell label="long text">
          <Badge tone="warning">Invitation expires in three days</Badge>
        </Cell>
      </Section>

      <Section
        title="Button"
        note="Every variant × every size × icon/no-icon, then loading, disabled and fullWidth. While loading the button is aria-disabled rather than disabled, so it keeps focus and stays in the tab order."
        wide
      >
        {BUTTON_VARIANTS.map((variant) =>
          BUTTON_SIZES.map((size) => (
            <Cell label={`${variant} / ${size}`} key={`${variant}-${size}`}>
              <Button variant={variant} size={size}>
                Label
              </Button>
              <Button variant={variant} size={size} icon={<PlusIcon />}>
                Icon
              </Button>
              <Button variant={variant} size={size} loading>
                Loading
              </Button>
              <Button variant={variant} size={size} disabled>
                Disabled
              </Button>
            </Cell>
          )),
        )}
        <Cell label="loading + icon" note="The glyph stays; the spinner is additive.">
          <Button variant="primary" icon={<PlusIcon />} loading>
            Creating
          </Button>
        </Cell>
        <Cell label="disabled + icon">
          <Button variant="primary" icon={<PlusIcon />} disabled>
            Create
          </Button>
        </Cell>
        <Cell label="fullWidth" stack>
          <Button variant="primary" fullWidth>
            Full width
          </Button>
          <Button fullWidth icon={<SearchIcon />}>
            Full width, icon
          </Button>
        </Cell>
        <Cell label="type=submit" note="The non-default. type defaults to button on purpose.">
          <Button type="submit" variant="primary">
            Submit
          </Button>
        </Cell>
        <Cell
          label="focused"
          note="Not drawn — faking it would be a drawing, not the ring. Tab to any button above."
        >
          <Button>Tab to me</Button>
        </Cell>
        <Cell
          label="hovered"
          note="Not drawn. Hover any button above; ghost is the one worth watching."
        >
          <Button variant="ghost">Hover me</Button>
        </Cell>
      </Section>

      <Checkboxes />
      <ConfirmDialogs />

      <Section
        title="EmptyState"
        note="Fades in after a delay so a list that is about to populate never flashes 'nothing here'. Give it a moment on load."
        wide
      >
        <Cell label="title only" stack>
          <EmptyState title="No issues" />
        </Cell>
        <Cell label="title + description" stack>
          <EmptyState title="No issues" description="Nothing has been filed in this team yet." />
        </Cell>
        <Cell label="icon + description + action" stack>
          <EmptyState
            icon={<SearchIcon />}
            title="No results"
            description="Nothing matched that search. Try fewer words."
            action={<Button variant="primary">Clear filters</Button>}
          />
        </Cell>
      </Section>

      <Section
        title="Field"
        note="The label-and-message frame Input, Textarea and Select all render through. Shown here wrapping a bare input, which is the only way to see the frame on its own."
        wide
      >
        <Cell label="label + hint" stack>
          <Field ids={fieldIds} label="Workspace name" hint="Visible to everyone you invite.">
            <input id={fieldIds.controlId} aria-describedby={fieldIds.hintId} />
          </Field>
        </Cell>
        <Cell
          label="error wins over hint"
          note="One message at a time, and aria-describedby follows it."
          stack
        >
          <Field
            ids={fieldIds}
            label="Workspace name"
            hint="This hint is not rendered."
            error="That name is taken."
          >
            <input id={fieldIds.controlId} aria-invalid aria-describedby={fieldIds.errorId} />
          </Field>
        </Cell>
        <Cell label="hideLabel" note="The name survives; the text does not." stack>
          <Field ids={fieldIds} label="Search" hideLabel>
            <input id={fieldIds.controlId} placeholder="Search" />
          </Field>
        </Cell>
        <Cell label="no label" stack>
          <Field ids={fieldIds} hint="A frame with nothing but a message.">
            <input id={fieldIds.controlId} />
          </Field>
        </Cell>
      </Section>

      <Section
        title="IconButton"
        note="Every variant × every size. The accessible name is a required prop, and the tooltip is on by default — hover or Tab to one to see it."
        wide
      >
        {ICON_BUTTON_VARIANTS.map((variant) =>
          ICON_BUTTON_SIZES.map((size) => (
            <Cell label={`${variant} / ${size}`} key={`${variant}-${size}`}>
              <IconButton aria-label="Add" icon={<PlusIcon />} variant={variant} size={size} />
              <IconButton aria-label="Search" icon={<SearchIcon />} variant={variant} size={size} />
              <IconButton
                aria-label="Delete"
                icon={<TrashIcon />}
                variant={variant}
                size={size}
                disabled
              />
            </Cell>
          )),
        )}
        <Cell label="tooltip + keys" note="Hover: the tip carries the shortcut.">
          <IconButton
            aria-label="Search"
            icon={<SearchIcon />}
            tooltip="Search issues"
            keys="mod+k"
          />
        </Cell>
        <Cell
          label="tooltip=null"
          note="No tip at all, for a control already spelled out beside it."
        >
          <IconButton aria-label="Add" icon={<PlusIcon />} tooltip={null} />
        </Cell>
        <Cell label="tooltipPlacement">
          {TOOLTIP_PLACEMENTS.map((placement) => (
            <IconButton
              key={placement}
              aria-label={placement}
              icon={<PlusIcon />}
              tooltipPlacement={placement}
            />
          ))}
        </Cell>
        <Cell
          label="focused"
          note="Not drawn. Tab to one — focus also opens its tooltip, with no delay."
        >
          <IconButton aria-label="Tab here" icon={<PlusIcon />} />
        </Cell>
      </Section>

      <Section
        title="Input"
        note="Boxed and plain surfaces, both with the full set of messages and affixes."
        wide
      >
        <Cell label="boxed, label + hint" stack>
          <Input
            label="Email"
            hint="We only use it to sign you in."
            defaultValue="ada@example.com"
          />
        </Cell>
        <Cell
          label="boxed, error"
          note="Present error means invalid: the text, the edge and aria-invalid are one decision."
          stack
        >
          <Input label="Email" error="That is not an email address." defaultValue="ada@" />
        </Cell>
        <Cell label="boxed, hideLabel" stack>
          <Input label="Search" hideLabel placeholder="Search issues…" />
        </Cell>
        <Cell label="boxed, no label" stack>
          <Input placeholder="No label at all" aria-label="Unlabelled" />
        </Cell>
        <Cell label="prefix" stack>
          <Input label="Search" prefix={<SearchIcon />} placeholder="Search issues…" />
        </Cell>
        <Cell label="suffix" stack>
          <Input label="Estimate" suffix="points" defaultValue="3" />
        </Cell>
        <Cell label="prefix + suffix" stack>
          <Input label="Budget" prefix="$" suffix="USD" defaultValue="1200" />
        </Cell>
        <Cell label="prefix + suffix + error" stack>
          <Input
            label="Budget"
            prefix="$"
            suffix="USD"
            defaultValue="-5"
            error="Must be positive."
          />
        </Cell>
        <Cell label="disabled" stack>
          <Input label="Email" disabled defaultValue="ada@example.com" />
        </Cell>
        <Cell label="readOnly" stack>
          <Input label="Identifier" readOnly defaultValue="ENG-123" />
        </Cell>
        <Cell
          label="plain surface"
          note="No border, no fill — where the text is the page. Until this pass it rendered as a fully boxed field: .plain and the composed .control tied on specificity and the bundler's emission order picked .control."
          stack
          canvas
        >
          <Input surface="plain" label="Issue title" hideLabel defaultValue="Issue title" />
        </Cell>
        <Cell
          label="plain surface, focused"
          note="Not drawn. Click or Tab in — a single bottom edge in --border-focus, no ring. This is the rule the cascade was discarding."
          stack
          canvas
        >
          <Input surface="plain" label="Issue title" hideLabel placeholder="Tab here" />
        </Cell>
        <Cell
          label="plain surface, error"
          note="The same single edge, in --priority-urgent, and it wins over the focus edge when the field is both."
          stack
          canvas
        >
          <Input surface="plain" label="Issue title" error="A title is required." />
        </Cell>
        <Cell label="plain surface, disabled" stack canvas>
          <Input surface="plain" label="Issue title" disabled defaultValue="Locked title" />
        </Cell>
        <Cell label="type=password" stack>
          <Input label="Password" type="password" defaultValue="hunter2" />
        </Cell>
        <Cell
          label="focused"
          note="Not drawn. Click or Tab in — the box takes --border-focus."
          stack
        >
          <Input label="Focus me" placeholder="Tab here" />
        </Cell>
      </Section>

      <Section
        title="Kbd"
        note="Takes the keymap's own spec string, not a drawn glyph, so the platform decides the spelling. The platform prop is here for exactly this kind of side-by-side."
      >
        <Cell label="detected platform">
          <Kbd keys="mod+k" />
          <Kbd keys="shift+/" />
          <Kbd keys="g i" />
        </Cell>
        <Cell label='platform="mac"'>
          <Kbd keys="mod+k" platform="mac" />
          <Kbd keys="mod+shift+p" platform="mac" />
          <Kbd keys="alt+enter" platform="mac" />
        </Cell>
        <Cell label='platform="other"'>
          <Kbd keys="mod+k" platform="other" />
          <Kbd keys="mod+shift+p" platform="other" />
          <Kbd keys="alt+enter" platform="other" />
        </Cell>
        <Cell label="sequence" note="Two chords, drawn as two keys.">
          <Kbd keys="g i" />
          <Kbd keys="g p" />
        </Cell>
      </Section>

      <Section
        title="LabelChip"
        note="The colour is workspace data and can be any value at all, so it is a dot and a wash rather than a background with computed text. Full size takes a dismiss control; compact cannot, and the type says so."
        wide
      >
        <Cell label="default">
          <LabelChip name="bug" color="#e5484d" />
          <LabelChip name="feature" color="#30a46c" />
          <LabelChip name="needs design" color="#f5d90a" />
        </Cell>
        <Cell label="compact" note="For an issue row, where the row is the click target.">
          <LabelChip name="bug" color="#e5484d" compact />
          <LabelChip name="feature" color="#30a46c" compact />
        </Cell>
        <Cell label="groupName" note="Reads as 'Priority: P0' so a bare P0 is not the only clue.">
          <LabelChip name="P0" color="#e5484d" groupName="Priority" />
          <LabelChip name="P0" color="#e5484d" groupName="Priority" compact />
        </Cell>
        <Cell label="onRemove" note="The dismiss control exists only when the handler does.">
          <LabelChip name="bug" color="#e5484d" onRemove={() => {}} />
          <LabelChip name="needs design" color="#f5d90a" groupName="Stage" onRemove={() => {}} />
        </Cell>
        <Cell
          label="hard colours"
          note="Yellow on light and near-black on dark are the two that break naive contrast maths."
        >
          <LabelChip name="yellow" color="#ffff00" />
          <LabelChip name="near-black" color="#050505" />
          <LabelChip name="white" color="#ffffff" />
        </Cell>
      </Section>

      <Section
        title="Logo"
        note="Every size, with and without the word. The mark animates on mount — reload to watch it."
      >
        {LOGO_SIZES.map((size) => (
          <Cell label={`size=${size}`} key={size}>
            <Logo size={size} />
          </Cell>
        ))}
        {LOGO_SIZES.map((size) => (
          <Cell label={`size=${size} markOnly`} key={`${size}-mark`}>
            <Logo size={size} markOnly />
          </Cell>
        ))}
      </Section>

      <Menus />
      <Modals />

      <Section
        title="PriorityIcon"
        note="Every level in PRIORITY_LEVELS, in the order the product lists them, plus the out-of-range value a future export could carry."
      >
        {PRIORITY_LEVELS.map((priority) => (
          <Cell
            label={`priority=${priority} — ${PRIORITY_LABELS[priority] ?? 'No priority'}`}
            key={priority}
          >
            <PriorityIcon priority={priority} />
          </Cell>
        ))}
        <Cell
          label="decorative"
          note="No role, no name — for a row that already names the priority."
        >
          <PriorityIcon priority={1} decorative /> Urgent
        </Cell>
        <Cell label="out of range" note="Falls back to 'No priority' rather than throwing.">
          <PriorityIcon priority={99} />
        </Cell>
      </Section>

      <Section
        title="Progress"
        note="A ring, not a bar, and role=img rather than progressbar — it is a standing fact about an issue, not an operation in flight."
      >
        <Cell label="0 / 25 / 50 / 75 / 100 (md)">
          {[0, 25, 50, 75, 100].map((percent) => (
            <Progress key={percent} percent={percent} label="Sub-issues" />
          ))}
        </Cell>
        <Cell label="0 / 25 / 50 / 75 / 100 (sm)">
          {[0, 25, 50, 75, 100].map((percent) => (
            <Progress key={percent} percent={percent} label="Sub-issues" size="sm" />
          ))}
        </Cell>
        <Cell label="detail" note="Read out alongside the percentage; hover for the tooltip.">
          <Progress percent={60} label="Sub-issues" detail="3 of 5 sub-issues" />
        </Cell>
        <Cell label="clamped" note="-20 and 140 are clamped rather than rejected.">
          <Progress percent={-20} label="Sub-issues" />
          <Progress percent={140} label="Sub-issues" />
        </Cell>
      </Section>

      <Section
        title="SecretField"
        note="The highest-consequence field in the product: a value shown exactly once. Read-only, selects itself on focus, and the copy button reports that it worked."
        wide
      >
        <Cell label="default" stack>
          <SecretField
            label="Your new API key"
            value="pol_sk_3f9a1c7e5b2d4086af13c9e75d0b24816fa5c9d3"
            consequence="This is the only time it will be shown. Copy it now or make a new one."
          />
        </Cell>
        <Cell label="short value" stack>
          <SecretField
            label="Invitation link"
            value="https://example.com/invite/abc123"
            consequence="Anyone with this link can join the workspace."
          />
        </Cell>
        <Cell label="copied" note="Not drawn — press Copy. The button reports success in place.">
          <SecretField
            label="Press copy"
            value="pol_sk_copy_me"
            consequence="Copying is the state worth looking at here."
          />
        </Cell>
      </Section>

      <Section
        title="Select"
        note="A native select in the shared frame. It has no plain surface; `prefix` is its one affix, and it carries the value's icon the way the detail rail's triggers do. Menu is still the component for a keyboard-driven property picker."
        wide
      >
        <Cell label="label + hint" stack>
          <Select label="Team" hint="You can change this later.">
            <option>Engineering</option>
            <option>Design</option>
          </Select>
        </Cell>
        <Cell label="error" stack>
          <Select label="Team" error="Pick a team.">
            <option value="">Choose…</option>
            <option>Engineering</option>
          </Select>
        </Cell>
        <Cell label="hideLabel" stack>
          <Select label="Team" hideLabel>
            <option>Engineering</option>
            <option>Design</option>
          </Select>
        </Cell>
        <Cell label="no label" stack>
          <Select aria-label="Team">
            <option>Engineering</option>
          </Select>
        </Cell>
        <Cell label="disabled" stack>
          <Select label="Team" disabled>
            <option>Engineering</option>
          </Select>
        </Cell>
        <Cell label="optgroup + long options" stack>
          <Select label="Status">
            <optgroup label="Open">
              <option>Backlog</option>
              <option>Todo — a very long option label to test truncation</option>
            </optgroup>
            <optgroup label="Closed">
              <option>Done</option>
            </optgroup>
          </Select>
        </Cell>
        <Cell
          label="prefix=StateIcon"
          note="The glyph is painted over the leading edge, not laid out beside it, so the whole box is still one click target and the native popup is untouched."
          stack
        >
          <Select
            label="Status"
            prefix={<StateIcon category="started" progress={0.5} decorative />}
          >
            <option>In Progress</option>
            <option>Todo</option>
            <option>Done</option>
          </Select>
        </Cell>
        <Cell
          label="prefix=PriorityIcon"
          note="The priority ramp, unchanged: .prefix sets no colour of its own, so each glyph keeps the colour its own component gives it."
          stack
        >
          <Select label="Priority" prefix={<PriorityIcon priority={2} decorative />}>
            <option>High</option>
            <option>Urgent</option>
            <option>Medium</option>
          </Select>
        </Cell>
        <Cell
          label="prefix=Avatar"
          note="Avatar at xs is 16px, the same as the two icon components — which is the number the reserved --space-8 of padding is built from."
          stack
        >
          <Select label="Assignee" prefix={<Avatar name="Ada Lovelace" size="xs" decorative />}>
            <option>Ada Lovelace</option>
            <option>Grace Hopper</option>
          </Select>
        </Cell>
        <Cell
          label="prefix + hint + error"
          note="The prefix sits inside the box, so the frame's label, hint and error treatment are unaffected by it."
          stack
        >
          <Select
            label="Assignee"
            error="Pick somebody."
            prefix={<Avatar name="Grace Hopper" size="xs" decorative />}
          >
            <option value="">Unassigned</option>
            <option>Grace Hopper</option>
          </Select>
        </Cell>
        <Cell
          label="prefix, disabled"
          note="Both overlays dim with the control. They are siblings of the <select>, so the element's own :disabled opacity never reached them — a disabled select used to keep a full-strength chevron."
          stack
        >
          <Select
            label="Assignee"
            disabled
            prefix={<Avatar name="Ada Lovelace" size="xs" decorative />}
          >
            <option>Ada Lovelace</option>
          </Select>
        </Cell>
        <Cell label="focused" note="Not drawn. Tab to it — the box takes --border-focus." stack>
          <Select label="Focus me">
            <option>Engineering</option>
          </Select>
        </Cell>
      </Section>

      <Section
        title="Spinner"
        note="Both sizes, bare and labelled. The label is the accessible name; without one it is hidden from the accessibility tree."
      >
        {SPINNER_SIZES.map((size) => (
          <Cell label={`size=${size}`} key={size}>
            <Spinner size={size} />
          </Cell>
        ))}
        {SPINNER_SIZES.map((size) => (
          <Cell label={`size=${size} + label`} key={`${size}-label`}>
            <Spinner size={size} label="Loading issues" />
          </Cell>
        ))}
        <Cell label="on an elevated surface" canvas>
          <Spinner />
          <Spinner size="sm" />
        </Cell>
      </Section>

      <Section
        title="StateIcon"
        note="Every category, then the started glyph swept through its progress fraction, then the colour override a team's custom status supplies."
        wide
      >
        {STATE_CATEGORIES.map((category) => (
          <Cell label={`category=${category} — ${STATE_LABELS[category]}`} key={category}>
            <StateIcon category={category} />
          </Cell>
        ))}
        <Cell label="started, progress 0 → 1">
          {[0, 0.25, 0.5, 0.75, 1].map((progress) => (
            <StateIcon key={progress} category="started" progress={progress} />
          ))}
        </Cell>
        <Cell label="color override" note="A workspace's own status colour, any CSS colour.">
          <StateIcon category="started" color="#ff8b00" progress={0.4} />
          <StateIcon category="unstarted" color="#8e4ec6" />
          <StateIcon category="completed" color="#30a46c" />
        </Cell>
        <Cell label="label override">
          <StateIcon category="started" label="In review" />
        </Cell>
        <Cell label="decorative" note="No role, no name — beside a written status.">
          <StateIcon category="completed" decorative /> Done
        </Cell>
      </Section>

      <Textareas />

      <Section
        title="Tooltip"
        note="Portalled and opened by hover or focus, so it cannot be pinned open in a static specimen. Hover or Tab to each trigger below; focus is exempt from the delay."
        wide
      >
        {TOOLTIP_PLACEMENTS.map((placement) => (
          <Cell label={`placement=${placement}`} key={placement}>
            <Tooltip label={`Tip on the ${placement}`} placement={placement}>
              <Button>Hover me</Button>
            </Tooltip>
          </Cell>
        ))}
        <Cell label="with keys">
          <Tooltip label="Search issues" keys="mod+k">
            <Button icon={<SearchIcon />}>Search</Button>
          </Tooltip>
        </Cell>
        <Cell label="delayMs=0" note="No rest before it appears.">
          <Tooltip label="Instant" delayMs={0}>
            <Button>Instant</Button>
          </Tooltip>
        </Cell>
        <Cell label="describe=false" note="Drawn but not attached as the trigger's description.">
          <Tooltip label="Archive" describe={false}>
            <Button>Archive</Button>
          </Tooltip>
        </Cell>
        <Cell label="rich label">
          <Tooltip
            label={
              <span>
                Assigned to <strong>Ada Lovelace</strong>
              </span>
            }
          >
            <Button icon={<PlusIcon />}>Assignee</Button>
          </Tooltip>
        </Cell>
      </Section>
    </div>
  );
}
