/**
 * Public marketing page.
 *
 * Shown at `/` (and `/welcome`) when nobody is signed in. A restored session — including
 * localhost auto-login via the refresh cookie — never lands here: Boot takes authenticated
 * users into the workspace, and `/` in that tree is still the first team's issue list.
 *
 * `/welcome` stays reachable after sign-in so a tester who is already in the app can still
 * look at the page without signing out. It is the same component, not a second skin.
 *
 * The copy and the chrome are Polar's. Nothing here is Linear's wording, layout tracing,
 * or assets. The product shots are CSS reconstructions of our own list, graph and keymap.
 */

import { Link } from 'react-router';

import { Avatar, Badge, Kbd, LabelChip, PriorityIcon, Progress, StateIcon } from '~/components';

import styles from './Landing.module.css';

const SOURCE = 'https://github.com/mcpeixoto/polaris';
const SELF_HOST_DOC =
  'https://github.com/mcpeixoto/polaris/blob/main/docs/05-infrastructure/11-self-hosting.md';

export function Landing() {
  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Link to="/" className={styles.wordmark}>
            Polaris
          </Link>
          <nav className={styles.navLinks} aria-label="Page">
            <a href="#product">Product</a>
            <a href="#keyboard">Keyboard</a>
            <a href="#sync">Sync</a>
            <a href="#self-host">Self-host</a>
          </nav>
          <div className={styles.navActions}>
            <Link to="/signin" className={styles.navQuiet}>
              Sign in
            </Link>
            <Link to="/signup" className={styles.cta}>
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <p className={styles.kicker}>Keyboard-first · Local-first · Self-hosted</p>
          <h1 id="hero-title" className={styles.heroTitle}>
            The fast path never touches the network.
          </h1>
          <p className={styles.heroLead}>
            Polaris is an issue tracker for software teams that keep the replica on the machine.
            Filter, sort and group against IndexedDB. The server&apos;s job is to keep that replica
            true — and to get out of the way of <Kbd keys="mod+k" />.
          </p>
          <div className={styles.heroCtas}>
            <Link to="/signup" className={styles.cta}>
              Get started
            </Link>
            <Link to="/signin" className={styles.ctaGhost}>
              Sign in
            </Link>
            <a href="#self-host" className={styles.ctaGhost}>
              Self-host
            </a>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Filter 5,000 issues</dt>
              <dd>0.2 ms</dd>
            </div>
            <div>
              <dt>Workspace snapshot</dt>
              <dd>24 ms / 20 KB</dd>
            </div>
            <div>
              <dt>Commit to delta</dt>
              <dd>&lt; 100 ms</dd>
            </div>
            <div>
              <dt>Licence</dt>
              <dd>AGPL-3.0</dd>
            </div>
          </dl>
          <figure className={styles.heroShot} aria-hidden="true">
            <IssueChrome />
          </figure>
        </section>

        <section id="product" className={styles.band} aria-labelledby="features-title">
          <div className={styles.bandHead}>
            <p className={styles.kicker}>Product</p>
            <h2 id="features-title" className={styles.sectionTitle}>
              The tracker, not a dashboard in front of one.
            </h2>
            <p className={styles.sectionLead}>
              Issues, projects, cycles, triage, initiatives and the timeline share one visual
              system: a 32px row, a keymap, a local replica. Nothing here is a slide.
            </p>
          </div>
          <ul className={styles.featureGrid} role="list">
            {FEATURES.map((feature) => (
              <li key={feature.title} className={styles.feature}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.split} aria-labelledby="issues-title">
          <div className={styles.splitCopy}>
            <p className={styles.kicker}>Issues</p>
            <h2 id="issues-title" className={styles.sectionTitle}>
              Twenty-two rows on a laptop. Not eleven.
            </h2>
            <p className={styles.sectionLead}>
              The issue list is the product. Identifiers, priority, status, labels and assignees
              share a 32px row. Peek with <Kbd keys="space" />, file with <Kbd keys="c" />, triage
              with <Kbd keys="g t" />.
            </p>
            <ul className={styles.points} role="list">
              <li>Parent / sub-issues, relations, estimates, due dates</li>
              <li>Triage as a hidden intake status — accept, duplicate, decline, snooze</li>
              <li>Archives and auto-close that respect parents, subs and projects</li>
            </ul>
          </div>
          <figure className={styles.shot} aria-hidden="true">
            <IssueChrome />
          </figure>
        </section>

        <section className={`${styles.split} ${styles.splitFlip}`} aria-labelledby="projects-title">
          <div className={styles.splitCopy}>
            <p className={styles.kicker}>Projects</p>
            <h2 id="projects-title" className={styles.sectionTitle}>
              Outcome, not a second issue list.
            </h2>
            <p className={styles.sectionLead}>
              Cross-team work with health from the latest update, milestones, dependencies and a
              timeline you can actually read. Initiatives sit above them. <Kbd keys="shift+p" />{' '}
              picks; <Kbd keys="c" /> files into the open project.
            </p>
            <ul className={styles.points} role="list">
              <li>Display → Timeline: Gantt bars, dependency lines, zoom</li>
              <li>Attached views as reorderable tabs on the project shell</li>
              <li>Project labels, templates, and update reminders</li>
            </ul>
          </div>
          <figure className={styles.shot} aria-hidden="true">
            <ProjectChrome />
          </figure>
        </section>

        <section className={styles.split} aria-labelledby="cycles-title">
          <div className={styles.splitCopy}>
            <p className={styles.kicker}>Cycles</p>
            <h2 id="cycles-title" className={styles.sectionTitle}>
              Cadence the team does not have to remember.
            </h2>
            <p className={styles.sectionLead}>
              Time-boxed, per-team, auto-repeating. Rollover and auto-add, a burn-up on the detail
              page, pause and cooldown gaps when the calendar is not a factory. <Kbd keys="g c" /> /{' '}
              <Kbd keys="shift+c" />.
            </p>
            <ul className={styles.points} role="list">
              <li>Auto-created windows from the team&apos;s cadence</li>
              <li>Edit dates and names; start a cycle today</li>
              <li>Graph of scope against completed, on the cycle itself</li>
            </ul>
          </div>
          <figure className={styles.shot} aria-hidden="true">
            <CycleChrome />
          </figure>
        </section>

        <section id="keyboard" className={styles.band} aria-labelledby="keyboard-title">
          <div className={styles.bandHead}>
            <p className={styles.kicker}>Keyboard</p>
            <h2 id="keyboard-title" className={styles.sectionTitle}>
              One registry. The menu is a view of it.
            </h2>
            <p className={styles.sectionLead}>
              Every action is registered once. The command menu, the help overlay and the bindings
              are the same list. A shortcut that is not in the registry does not exist — which is
              how you keep a hundred chords from colliding.
            </p>
          </div>
          <div className={styles.keyboardRow}>
            <figure className={styles.shot} aria-hidden="true">
              <CommandChrome />
            </figure>
            <ul className={styles.shortcutList} role="list">
              {SHORTCUTS.map((row) => (
                <li key={row.keys} className={styles.shortcut}>
                  <Kbd keys={row.keys} />
                  <span>{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="sync" className={styles.split} aria-labelledby="sync-title">
          <div className={styles.splitCopy}>
            <p className={styles.kicker}>Sync</p>
            <h2 id="sync-title" className={styles.sectionTitle}>
              Local-first is the architecture, not a badge.
            </h2>
            <p className={styles.sectionLead}>
              A gapless per-workspace version stream, NDJSON bootstrap, WebSocket hub, resume and
              revoke. Optimistic mutations land in a durable outbox. Offline is the ordinary case;
              the network is how the replica stays true.
            </p>
            <ul className={styles.points} role="list">
              <li>IndexedDB replica, in-memory indexes, client schema 21</li>
              <li>GraphQL over the whole domain — the same API the product uses</li>
              <li>Argon2id, rotating refresh tokens, HttpOnly cookies</li>
            </ul>
          </div>
          <figure className={styles.shot} aria-hidden="true">
            <SyncChrome />
          </figure>
        </section>

        <section className={styles.band} aria-labelledby="proof-title">
          <div className={styles.bandHead}>
            <p className={styles.kicker}>Teams</p>
            <h2 id="proof-title" className={styles.sectionTitle}>
              Built for people who run their own iron.
            </h2>
            <p className={styles.sectionLead}>
              Placeholders, on purpose. Polaris is invite-only until quotas and abuse controls are
              proven. These marks stand in for the row that will live here.
            </p>
          </div>
          <ul className={styles.logos} role="list">
            {LOGOS.map((name) => (
              <li key={name} className={styles.logo}>
                {name}
              </li>
            ))}
          </ul>
          <ul className={styles.quotes} role="list">
            {QUOTES.map((quote) => (
              <li key={quote.org} className={styles.quote}>
                <p>“{quote.text}”</p>
                <p className={styles.quoteWho}>
                  {quote.who}
                  <span>{quote.org}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section id="self-host" className={styles.ctaBand} aria-labelledby="selfhost-title">
          <p className={styles.kicker}>Self-host</p>
          <h2 id="selfhost-title" className={styles.sectionTitle}>
            Unlimited seats. You bring the machine.
          </h2>
          <p className={styles.sectionLead}>
            AGPL core, Docker Compose, no published ports on the datastore. The paid pitch is that
            you do not want to run it — plus SSO, SCIM, audit log. Cloud is EU-only when it exists;
            self-hosters choose their hardware.
          </p>
          <pre className={styles.code}>
            <code>
              {'make up && make migrate && make seed\nmake api   # then: make sync, make web'}
            </code>
          </pre>
          <div className={styles.heroCtas}>
            <Link to="/signup" className={styles.cta}>
              Get started
            </Link>
            <Link to="/signin" className={styles.ctaGhost}>
              Sign in
            </Link>
            <a href={SELF_HOST_DOC} className={styles.ctaGhost}>
              Self-hosting notes
            </a>
            <a href={SOURCE} className={styles.ctaGhost}>
              Source
            </a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link to="/" className={styles.wordmark}>
          Polaris
        </Link>
        <p>Keyboard-first issue tracking. Local replica. AGPL-3.0.</p>
        <nav aria-label="Footer">
          <Link to="/signin">Sign in</Link>
          <Link to="/signup">Get started</Link>
          <a href="#self-host">Self-host</a>
          <a href={SOURCE}>GitHub</a>
        </nav>
      </footer>
    </div>
  );
}

const FEATURES: readonly { title: string; body: string }[] = [
  {
    title: 'Issues',
    body: 'Workflow statuses, priority, labels, estimates, SLA, relations, parent and sub-issues.',
  },
  {
    title: 'Projects',
    body: 'Health, milestones, dependencies, attached views, labels, templates, update reminders.',
  },
  {
    title: 'Cycles',
    body: 'Per-team cadence, auto-created windows, rollover, graph, pause and cooldown gaps.',
  },
  {
    title: 'Triage',
    body: 'Hidden intake. Accept, duplicate, decline, snooze. G T, then 1 2 3 H.',
  },
  {
    title: 'Initiatives',
    body: 'Workspace objectives grouping curated projects, with owner, status and target date.',
  },
  {
    title: 'Timeline',
    body: 'Gantt on /projects: bars, dependency lines, milestones, zoom. Web-only, no extra store.',
  },
  {
    title: 'Documents',
    body: 'Team and project markdown, on the sync stream, with archive and soft-delete.',
  },
  {
    title: 'Inbox',
    body: 'Notifications, unread badge, subscriptions, coalescing fan-out, digest email.',
  },
];

const SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: 'mod+k', label: 'Command menu' },
  { keys: 'c', label: 'Create issue' },
  { keys: 'space', label: 'Peek' },
  { keys: 'g i', label: 'Inbox' },
  { keys: 'g t', label: 'Triage' },
  { keys: 'g c', label: 'Cycles' },
  { keys: 'shift+p', label: 'Project picker' },
  { keys: 'mod+shift+u', label: 'Add link' },
];

const LOGOS = [
  'Northwind Labs',
  'Harbourline',
  'Kite & Co.',
  'Second System',
  'Redoubt',
  'Atelier',
] as const;

const QUOTES: readonly { text: string; who: string; org: string }[] = [
  {
    text: 'The list is already there when the packet is not. That is the whole product.',
    who: 'Placeholder',
    org: 'A team that runs the box',
  },
  {
    text: 'We stopped briefing people on shortcuts. They find them because the menu is the registry.',
    who: 'Placeholder',
    org: 'A keyboard-first shop',
  },
  {
    text: 'Self-host, AGPL, no seat tax. The replica is ours even when the uplink is not.',
    who: 'Placeholder',
    org: 'An infra team',
  },
];

function IssueChrome() {
  return (
    <div className={styles.chrome}>
      <aside className={styles.chromeSide}>
        <div className={styles.chromeMark}>
          <span>P</span> polaris
        </div>
        <span className={styles.chromeNav}>Inbox</span>
        <span className={styles.chromeNav}>My issues</span>
        <span className={`${styles.chromeNav} ${styles.chromeNavOn}`}>Issues</span>
        <span className={styles.chromeNav}>Projects</span>
        <span className={styles.chromeNav}>Cycles</span>
        <span className={styles.chromeTeam}>ENG</span>
      </aside>
      <div className={styles.chromeMain}>
        <div className={styles.chromeBar}>
          <span>Issues</span>
          <span className={styles.chromeHint}>
            Active · <Kbd keys="c" />
          </span>
        </div>
        <div className={styles.issueGroup}>
          <span>In progress</span>
          <span>4</span>
        </div>
        <IssueRow
          id="ENG-412"
          title="Gapless versions under the workspace lock"
          priority={1}
          category="started"
          progress={0.6}
          label="sync"
          labelColor="var(--accent)"
          who="Ada"
        />
        <IssueRow
          id="ENG-398"
          title="Triage snooze respects the team timezone"
          priority={2}
          category="started"
          progress={0.35}
          label="intake"
          labelColor="var(--state-triage)"
          who="Lin"
        />
        <div className={styles.issueGroup}>
          <span>Todo</span>
          <span>12</span>
        </div>
        <IssueRow
          id="ENG-441"
          title="Cycle cooldown gap on the team calendar"
          priority={3}
          category="unstarted"
          label="cycles"
          labelColor="var(--priority-medium)"
          who="Nia"
        />
        <IssueRow
          id="ENG-419"
          title="Peek keeps focus on the originating row"
          priority={4}
          category="unstarted"
          label="keyboard"
          labelColor="var(--priority-low)"
        />
        <IssueRow
          id="ENG-405"
          title="Project timeline lines for blocked-by"
          priority={0}
          category="backlog"
          label="projects"
          labelColor="var(--accent-text)"
          who="Kai"
        />
      </div>
    </div>
  );
}

function IssueRow({
  id,
  title,
  priority,
  category,
  progress,
  label,
  labelColor,
  who,
}: {
  id: string;
  title: string;
  priority: number;
  category: 'backlog' | 'unstarted' | 'started' | 'completed';
  progress?: number;
  label: string;
  labelColor: string;
  who?: string;
}) {
  return (
    <div className={styles.issueRow}>
      <PriorityIcon priority={priority} decorative />
      <StateIcon category={category} progress={progress} decorative />
      <span className={styles.issueId}>{id}</span>
      <span className={styles.issueTitle}>{title}</span>
      <LabelChip name={label} color={labelColor} compact />
      {who === undefined ? (
        <span className={styles.unassigned} />
      ) : (
        <Avatar name={who} size="xs" decorative />
      )}
    </div>
  );
}

function ProjectChrome() {
  return (
    <div className={styles.chrome}>
      <div className={styles.chromeMain}>
        <div className={styles.chromeBar}>
          <span>Projects</span>
          <span className={styles.chromeHint}>Display → Timeline</span>
        </div>
        <div className={styles.projectHead}>
          <span>Name</span>
          <span>Health</span>
          <span>This quarter</span>
        </div>
        <ProjectRow
          name="Sync engine"
          health="On track"
          tone="success"
          start={8}
          span={42}
          mark="var(--accent)"
        />
        <ProjectRow
          name="Cycles v1"
          health="At risk"
          tone="warning"
          start={22}
          span={28}
          mark="var(--priority-medium)"
        />
        <ProjectRow
          name="Triage intake"
          health="On track"
          tone="success"
          start={4}
          span={36}
          mark="var(--state-triage)"
        />
        <ProjectRow
          name="Project updates"
          health="Off track"
          tone="danger"
          start={36}
          span={24}
          mark="var(--priority-urgent)"
        />
        <div className={styles.timelineScale}>
          <span>Jun</span>
          <span>Jul</span>
          <span>Aug</span>
          <span>Sep</span>
        </div>
      </div>
    </div>
  );
}

function ProjectRow({
  name,
  health,
  tone,
  start,
  span,
  mark,
}: {
  name: string;
  health: string;
  tone: 'success' | 'warning' | 'danger';
  start: number;
  span: number;
  mark: string;
}) {
  return (
    <div className={styles.projectRow}>
      <span className={styles.projectName}>{name}</span>
      <Badge tone={tone}>{health}</Badge>
      <div className={styles.timeline}>
        <span
          className={styles.timelineBar}
          style={{
            marginInlineStart: `${String(start)}%`,
            width: `${String(span)}%`,
            backgroundColor: mark,
          }}
        />
      </div>
    </div>
  );
}

function CycleChrome() {
  return (
    <div className={styles.chrome}>
      <div className={styles.chromeMain}>
        <div className={styles.chromeBar}>
          <span>Cycle 24</span>
          <span className={styles.chromeHint}>Success 72% · 18 / 25</span>
        </div>
        <svg
          className={styles.cycleChart}
          viewBox="0 0 320 96"
          preserveAspectRatio="none"
          role="img"
        >
          <path
            d="M8 72 C 60 70, 90 68, 120 64 S 180 58, 210 52 S 270 40, 312 36"
            className={styles.cycleScope}
          />
          <path
            d="M8 80 C 50 78, 80 74, 110 68 S 170 52, 200 44 S 260 28, 312 18"
            className={styles.cycleDone}
          />
        </svg>
        <div className={styles.cycleLegend}>
          <span>
            <span className={styles.swatchMuted} /> Scope
          </span>
          <span>
            <span className={styles.swatchAccent} /> Completed
          </span>
        </div>
        <div className={styles.issueGroup}>
          <span>This cycle</span>
          <span>6</span>
        </div>
        <IssueRow
          id="ENG-412"
          title="Gapless versions under the workspace lock"
          priority={1}
          category="started"
          progress={0.6}
          label="sync"
          labelColor="var(--accent)"
          who="Ada"
        />
        <IssueRow
          id="ENG-398"
          title="Triage snooze respects the team timezone"
          priority={2}
          category="completed"
          label="intake"
          labelColor="var(--state-triage)"
          who="Lin"
        />
      </div>
    </div>
  );
}

function CommandChrome() {
  return (
    <div className={styles.palette}>
      <div className={styles.paletteBar}>
        <span className={styles.paletteQuery}>Set status…</span>
        <Kbd keys="mod+k" />
      </div>
      <div className={styles.paletteItem}>
        <span>Create issue</span>
        <Kbd keys="c" />
      </div>
      <div className={`${styles.paletteItem} ${styles.paletteOn}`}>
        <span>Peek</span>
        <Kbd keys="space" />
      </div>
      <div className={styles.paletteItem}>
        <span>Go to triage</span>
        <Kbd keys="g t" />
      </div>
      <div className={styles.paletteItem}>
        <span>Go to cycles</span>
        <Kbd keys="g c" />
      </div>
      <div className={styles.paletteItem}>
        <span>Project picker</span>
        <Kbd keys="shift+p" />
      </div>
    </div>
  );
}

function SyncChrome() {
  return (
    <div className={styles.syncGrid}>
      <div className={styles.syncCard}>
        <p className={styles.syncLabel}>Replica</p>
        <p className={styles.syncValue}>IndexedDB · schema 21</p>
        <ul role="list">
          <li>In-memory indexes</li>
          <li>Durable outbox</li>
          <li>Optimistic mutations</li>
        </ul>
        <p className={styles.syncLive}>Live · 0 queued</p>
      </div>
      <div className={styles.syncCard}>
        <p className={styles.syncLabel}>Hub</p>
        <p className={styles.syncValue}>WebSocket · NDJSON</p>
        <ul role="list">
          <li>Gapless versions</li>
          <li>Resume / revoke</li>
          <li>Backpressure</li>
        </ul>
        <p className={styles.syncLive}>v 184_203</p>
      </div>
      <div className={styles.syncMeter}>
        <span>Bootstrap</span>
        <Progress percent={100} label="Bootstrap" detail="20 KB gzipped" />
        <span>20 KB gzipped · 24 ms</span>
      </div>
    </div>
  );
}
