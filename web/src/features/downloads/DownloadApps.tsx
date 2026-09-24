/**
 * A quiet way out of the browser, once somebody is already in the workspace.
 *
 * The marketing page and `/downloads` already list the installers. Both are a navigation
 * away, and the second one is behind the workspace menu — the control people open to
 * switch workspaces, not to find an app. This sits in the sidebar foot, next to Help,
 * and the menu is the download: each row is a file, not a page about a file.
 *
 * The URLs are the stable names from `landingDownloads`. They have no version in them,
 * because a version written here goes stale on the next release and the button 404s
 * without anything failing. The same names are what `scripts/lint-release.sh` checks the
 * release workflow still uploads.
 */

import { useNavigate } from 'react-router';

import { useActions } from '~/app/keymap';
import { IconButton, Menu, type MenuNode } from '~/components';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';

import {
  detectDownloadOS,
  orderedDownloads,
  type DownloadBuild,
  type DownloadPlatform,
} from '~/views/landingDownloads';

export function DownloadApps() {
  const menu = useMenuTrigger();
  const navigate = useNavigate();

  useActions(
    [
      {
        id: 'app.download',
        title: 'Download desktop apps',
        group: 'General',
        run: () => menu.show(),
      },
    ],
    [menu.show],
  );

  return (
    <>
      <IconButton
        aria-label="Download apps"
        tooltip="Download Polaris"
        variant="secondary"
        shape="round"
        icon={<DownloadGlyph />}
        {...menu.props}
      />
      <Menu
        open={menu.open}
        onClose={menu.hide}
        trigger={menu.ref}
        label="Download Polaris"
        placement="top-start"
        items={downloadItems(() => void navigate('/downloads'))}
      />
    </>
  );
}

function downloadItems(onAll: () => void): readonly MenuNode[] {
  const nodes: MenuNode[] = [];
  for (const platform of orderedDownloads(detectDownloadOS())) {
    nodes.push({ kind: 'heading', label: platform.name });
    for (const build of platform.builds) {
      nodes.push(downloadItem(platform, build));
    }
  }
  nodes.push({ kind: 'separator' });
  nodes.push({
    id: 'all-downloads',
    label: 'All downloads',
    onSelect: onAll,
  });
  return nodes;
}

function downloadItem(platform: DownloadPlatform, build: DownloadBuild): MenuNode {
  return {
    id: `${platform.os}-${build.label}`,
    label: build.label,
    // The clause before the filename: "M1 and later", "64-bit", "Runs anywhere".
    hint: build.detail.split(' · ')[0],
    text: `${platform.name} ${build.label}`,
    onSelect: () => startDownload(build.url),
  };
}

/**
 * Follows a release URL.
 *
 * No `download` attribute. These URLs are on github.com, and a browser ignores `download`
 * on a cross-origin link — setting it would look like a save and then navigate anyway.
 * A plain click follows `/releases/latest/download/…` and the response is the file.
 */
function startDownload(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function DownloadGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.75v6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M5.25 7.1 8 9.85l2.75-2.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3.5 13.25h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
