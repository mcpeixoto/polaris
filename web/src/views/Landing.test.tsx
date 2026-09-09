import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { Landing } from './Landing';

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe('Landing', () => {
  it('has a heading a screen reader can find', () => {
    renderLanding();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Issue tracking without the wait.' }),
    ).toBeTruthy();
  });

  it('offers sign in, get started, and self-host', () => {
    renderLanding();
    const started = screen.getAllByRole('link', { name: 'Get started' });
    const signIn = screen.getAllByRole('link', { name: 'Sign in' });
    expect(started[0]?.getAttribute('href')).toBe('/signup');
    expect(signIn[0]?.getAttribute('href')).toBe('/signin');
    expect(screen.getAllByRole('link', { name: 'Self-host' })[0]?.getAttribute('href')).toBe(
      '#self-host',
    );
  });

  it('links the repository from the header, not only the footer', () => {
    renderLanding();
    // Every GitHub link on the page points at the same repository, and at least one of
    // them is in the header: "open source" is a claim a reader checks by clicking, and
    // the footer is three screens down from where they decide.
    const repo = 'https://github.com/mcpeixoto/polaris';
    const links = screen.getAllByRole('link', { name: 'GitHub' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(repo);
    }
  });

  it('names the product surfaces Polar actually ships', () => {
    renderLanding();
    for (const name of ['Issues', 'Projects', 'Cycles', 'Triage', 'Initiatives', 'Timeline']) {
      expect(screen.getAllByText(name).length, name).toBeGreaterThan(0);
    }
    expect(screen.getByRole('heading', { name: 'Every shortcut in one place.' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Offline is the normal case.' })).toBeTruthy();
  });

  it('carries pricing in the nav and a band that links to the page', () => {
    renderLanding();
    expect(screen.getAllByRole('link', { name: 'Pricing' })[0]?.getAttribute('href')).toBe(
      '#pricing',
    );
    expect(screen.getByRole('link', { name: 'Compare plans' }).getAttribute('href')).toBe(
      '/pricing',
    );
    // Quoted from features/pricing/plans.ts rather than typed into the copy, so the poster
    // and the price list cannot disagree in front of a customer.
    expect(screen.getAllByText(/€4/).length).toBeGreaterThan(0);
  });

  /**
   * The self-host band used to end "Cloud is EU-only when it exists". Cloud is now something
   * we sell, and a marketing page still saying the product does not exist is the one sentence
   * that costs a sign-up outright.
   */
  it('no longer says the cloud does not exist', () => {
    const { container } = renderLanding();
    expect(container.textContent).not.toContain('when it exists');
  });

  /**
   * The page carried a logo strip and three pull quotes that were openly labelled
   * "Placeholder". Invented company names and invented sentences read as unfinished
   * whether or not the page admits they are stand-ins, so the band is gone until there
   * are real customers to name.
   */
  it('ships no invented customers or testimonials', () => {
    const { container } = renderLanding();
    expect(container.textContent).not.toContain('Placeholder');
    expect(container.textContent).not.toContain('Northwind Labs');
  });

  /**
   * Below the md breakpoint the five section links are `display: none`, and for a while nothing
   * replaced them: on a phone the page offered a logo, a sign-in and no route to Keyboard,
   * Sync or Self-host at all. The panel is the replacement, and these are the three things
   * about it that a stylesheet cannot guarantee.
   *
   * The width is not asserted — jsdom has no layout and the toggle is present at every
   * width, hidden by a media query. What is asserted is that the panel is a real
   * disclosure: closed to begin with, open on click, closed again on Escape, and carrying
   * the same links the wide header does.
   */
  describe('the compact menu', () => {
    it('starts closed, with its links out of the tree', () => {
      renderLanding();
      const toggle = screen.getByRole('button', { name: 'Open menu' });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('navigation', { name: 'Page, compact' })).toBeNull();
    });

    it('opens on click and offers every section the wide header does', async () => {
      const user = userEvent.setup();
      renderLanding();

      await user.click(screen.getByRole('button', { name: 'Open menu' }));

      const panel = screen.getByRole('navigation', { name: 'Page, compact' });
      const labels = [...panel.querySelectorAll('a')].map((link) => link.textContent);
      expect(labels).toEqual(['Product', 'Keyboard', 'Sync', 'Pricing', 'Self-host']);
      expect(screen.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')).toBe(
        'true',
      );
    });

    it('closes on Escape, because a panel with no visible edge needs a way out', async () => {
      const user = userEvent.setup();
      renderLanding();

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('navigation', { name: 'Page, compact' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    });

    it('closes when a link inside it is taken', async () => {
      const user = userEvent.setup();
      renderLanding();

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      const panel = screen.getByRole('navigation', { name: 'Page, compact' });
      await user.click([...panel.querySelectorAll('a')][1]!);

      expect(screen.queryByRole('navigation', { name: 'Page, compact' })).toBeNull();
    });
  });
  /**
   * The desktop builds have been published on GitHub for months and nothing on this page
   * pointed at them, so installing Polaris meant already knowing where a project keeps its
   * release artifacts. These are what a stylesheet cannot guarantee: every platform is
   * reachable, the visitor's own leads, each button goes to the file itself rather than to
   * a page listing fifteen of them, no link carries a version that a release would make
   * stale, and the unsigned builds say so before the operating system does.
   */
  describe('the desktop downloads', () => {
    const LATEST = 'https://github.com/mcpeixoto/polaris/releases/latest';

    /**
     * The stable asset names, which are a contract with `.github/workflows/desktop.yml`:
     * it uploads a copy of each installer under exactly these names, and
     * `scripts/lint-release.sh` fails if it stops. Renaming one here without renaming it
     * there produces a band of dead buttons that nothing else notices.
     */
    const DIRECT: Record<string, string> = {
      'Download Polaris for macOS, Apple Silicon': `${LATEST}/download/Polaris-mac-arm64.dmg`,
      'Download Polaris for macOS, Intel': `${LATEST}/download/Polaris-mac-x64.dmg`,
      'Download Polaris for Windows, Installer': `${LATEST}/download/Polaris-Setup.exe`,
      'Download Polaris for Linux, AppImage': `${LATEST}/download/Polaris-linux-x86_64.AppImage`,
      'Download Polaris for Linux, Debian / Ubuntu': `${LATEST}/download/polaris-amd64.deb`,
    };

    /** Renders with a stubbed user agent, because jsdom's own is whatever CI runs on. */
    function renderOn(hint: { userAgent: string; platform: string }) {
      vi.stubGlobal('navigator', hint);
      try {
        return renderLanding();
      } finally {
        vi.unstubAllGlobals();
      }
    }

    const MAC = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
    };
    const WINDOWS = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' };
    const LINUX = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' };

    it('offers every platform, and both Mac architectures, as direct downloads', () => {
      renderOn(WINDOWS);
      for (const [name, href] of Object.entries(DIRECT)) {
        expect(screen.getByRole('link', { name }).getAttribute('href'), name).toBe(href);
      }
    });

    /**
     * The failure this guards is silent and delayed. A version in one of these URLs keeps
     * working until the next release, then serves an old build or 404s — and the release
     * that broke it is green, because nothing downstream reads these strings.
     */
    it('links no file by a name that a release would make stale', () => {
      renderOn(MAC);
      for (const link of screen.getAllByRole('link', { name: /^Download Polaris for/ })) {
        const href = link.getAttribute('href') ?? '';
        expect(href.startsWith(`${LATEST}/download/`), href).toBe(true);
        expect(/\d+\.\d+\.\d+/.test(href), href).toBe(false);
      }
    });

    it('still offers the releases page, for notes and older versions', () => {
      renderOn(MAC);
      expect(
        screen.getByRole('link', { name: 'Release notes and older versions' }).getAttribute('href'),
      ).toBe(LATEST);
    });

    it('leads with the machine the visitor is on, without dropping the others', () => {
      for (const [hint, first] of [
        [MAC, 'macOS'],
        [WINDOWS, 'Windows'],
        [LINUX, 'Linux'],
      ] as const) {
        const { container, unmount } = renderOn(hint);
        const cards = [...container.querySelectorAll('#download li')];
        expect(cards.length, first).toBe(3);
        expect(cards[0]?.textContent, first).toContain(first);
        expect(cards[0]?.textContent, first).toContain('Your machine');
        // Nothing is hidden because it was not guessed: all three are still on the page.
        for (const name of ['macOS', 'Windows', 'Linux']) {
          expect(
            cards.some((card) => card.textContent?.includes(name)),
            name,
          ).toBe(true);
        }
        unmount();
      }
    });

    it('falls back to a plain Download when the machine is not recognisable', () => {
      renderOn({ userAgent: 'Polaris/1.0 (unknown)', platform: '' });
      // Header, compact menu, hero and footer all say plain "Download" here: with nothing
      // guessed there is no platform to name in the button.
      const plain = screen.getAllByRole('link', { name: 'Download' });
      expect(plain.length).toBeGreaterThan(0);
      for (const link of plain) expect(link.getAttribute('href')).toBe('#download');
      expect(screen.queryByText('Your machine')).toBeNull();
      // Still three platforms — an unrecognised visitor gets the full list, not an empty band.
      expect(screen.getAllByRole('link', { name: /^Download Polaris for/ }).length).toBe(5);
    });

    /**
     * Windows only, now. The mac build is signed and notarised — the release workflow will
     * not publish one that `spctl` refuses — so a note about Gatekeeper there would describe
     * a dialog that no longer appears.
     */
    it('warns about the unsigned builds before the operating system does', () => {
      const { container } = renderOn(MAC);
      const text = container.textContent ?? '';
      expect(text).toContain('not signed yet');
      expect(text).toContain('SmartScreen');
      expect(text).toContain('Run anyway');
      // And says nothing about Gatekeeper: the mac build is signed and notarised, and the
      // release workflow refuses to publish one that `spctl` does not accept. Instructions
      // for a dialog that no longer appears are their own kind of confusing.
      expect(text).not.toContain('right-click Polaris, choose Open');
    });

    it('is reachable from the header and the footer, not only from the band', () => {
      const { container } = renderOn(MAC);
      const header = container.querySelector('header');
      const footer = container.querySelector('footer');
      expect(
        [...(header?.querySelectorAll('a') ?? [])].some(
          (a) => a.getAttribute('href') === '#download',
        ),
      ).toBe(true);
      expect(
        [...(footer?.querySelectorAll('a') ?? [])].some(
          (a) => a.getAttribute('href') === '#download',
        ),
      ).toBe(true);
      // The hero says which one it thinks you want.
      expect(screen.getByRole('link', { name: 'Download for macOS' }).getAttribute('href')).toBe(
        '#download',
      );
    });

    /**
     * The compact menu's link list is asserted exactly, above. The download link lives
     * beside that landmark rather than inside it, the way the GitHub link already does.
     */
    it('reaches the compact menu without joining the five section links', async () => {
      const user = userEvent.setup();
      renderOn(MAC);

      await user.click(screen.getByRole('button', { name: 'Open menu' }));

      const panel = screen.getByRole('navigation', { name: 'Page, compact' });
      expect([...panel.querySelectorAll('a')].map((link) => link.textContent)).toEqual([
        'Product',
        'Keyboard',
        'Sync',
        'Pricing',
        'Self-host',
      ]);
      const menu = document.getElementById('nav-menu');
      expect(
        [...(menu?.querySelectorAll('a') ?? [])].some(
          (a) => a.getAttribute('href') === '#download',
        ),
      ).toBe(true);
    });
  });
});
