#!/usr/bin/env node
/**
 * Launches the packaged application and checks that it renders.
 *
 * This exists because "the build is green" and "the app works" are different claims, and
 * for an Electron shell they diverge in a specific way: everything about it type-checks and
 * packages long after it has stopped starting. The main process is ESM, half its
 * dependencies are CommonJS, and the interop between them fails at *link* time — no log
 * line, no stack, no window, just the OS dialog nobody sees on a CI runner. A shell can be
 * broken for weeks behind a passing matrix.
 *
 * So this drives the real artefact through Chrome DevTools Protocol and asserts the thing a
 * person would check first: that there is a window, and that something is in it.
 *
 *     node scripts/smoke.mjs [path/to/app-binary]
 *
 * With no argument it finds the binary electron-builder just wrote. Uses a throwaway
 * user-data directory, so it always sees a first run and never touches real settings.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE = path.join(HERE, '..', 'release');

const DEBUG_PORT = 9333;
/** Generous: a cold start on a loaded CI runner is slow, and a hang must still fail. */
const LAUNCH_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 30_000;

/**
 * Where electron-builder leaves something executable.
 *
 * The unpacked directory rather than the .dmg or the installer: mounting a disk image or
 * running an NSIS installer on a CI runner tests the packaging tool, and what is in doubt
 * here is the application.
 */
function findBinary() {
  // Every platform builds more than one architecture, and the runner can only honestly
  // execute its own — an x64 build starting under Rosetta proves something, but not the
  // thing an arm64 user is downloading. Native first, whatever exists second.
  const candidates =
    process.platform === 'darwin'
      ? (process.arch === 'arm64' ? ['mac-arm64', 'mac'] : ['mac', 'mac-arm64']).map((dir) =>
          path.join(RELEASE, dir, 'Polaris.app', 'Contents', 'MacOS', 'Polaris'),
        )
      : process.platform === 'win32'
        ? (process.arch === 'arm64'
            ? ['win-arm64-unpacked', 'win-unpacked']
            : ['win-unpacked', 'win-arm64-unpacked']
          ).map((dir) => path.join(RELEASE, dir, 'Polaris.exe'))
        : [path.join(RELEASE, 'linux-unpacked', 'polaris')];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `no packaged app found under ${RELEASE}. Run electron-builder first.\nLooked for:\n  ${candidates.join('\n  ')}`,
    );
  }
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The debugger is not listening the instant the process starts; poll rather than guess. */
async function waitForPageTarget(deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      // DevTools itself is a target too, and so is any window opened detached. The renderer
      // is the one on the app's own scheme.
      const page = targets.find(
        (target) => target.type === 'page' && !target.url.startsWith('devtools://'),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Connection refused until Chromium has bound the port.
    }
    await sleep(250);
  }
  throw new Error(
    'the app never opened a debuggable window. That is the shape of a main-process crash: ' +
      'Electron shows a modal error dialog and no window is ever created.',
  );
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const events = [];

    socket.addEventListener('message', (message) => {
      const frame = JSON.parse(message.data);
      if (frame.id !== undefined) {
        const settle = pending.get(frame.id);
        pending.delete(frame.id);
        settle?.(frame);
        return;
      }
      events.push(frame);
    });
    socket.addEventListener('error', () => reject(new Error(`cannot attach to ${url}`)));
    socket.addEventListener('open', () =>
      resolve({
        events,
        send: (method, params = {}) =>
          new Promise((settle) => {
            const id = ++nextId;
            pending.set(id, settle);
            socket.send(JSON.stringify({ id, method, params }));
          }),
        close: () => socket.close(),
      }),
    );
  });
}

/** Runs in the renderer. Deliberately says nothing about *which* screen, only that one drew. */
const PROBE = `(() => {
  const root = document.getElementById('root');
  return JSON.stringify({
    url: location.href,
    mounted: root ? root.childElementCount : -1,
    title: document.title,
    // A debuggable target exists whether or not the window was ever shown, so "it launched"
    // and "the user can see it" are different claims — and the failure that motivated the
    // reveal timeout in main.ts is exactly a process with a dock icon and no window.
    visible: document.visibilityState === 'visible',
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
  });
})()`;

async function main() {
  const binary = process.argv[2] ?? findBinary();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-smoke-'));
  console.log(`• launching ${binary}`);

  const child = spawn(
    binary,
    [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  let exited = null;
  child.on('exit', (code, signal) => {
    exited = signal ?? code;
  });

  const stop = () => {
    child.kill();
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      // The app is still flushing its profile as this runs, so the directory can refill
      // between the walk and the unlink. A leftover temp directory is not a test failure,
      // and reporting one as such is how a green suite starts being ignored.
    }
  };

  try {
    const target = await waitForPageTarget(Date.now() + LAUNCH_TIMEOUT_MS);
    if (exited !== null) throw new Error(`the app exited (${exited}) before it could be driven`);

    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    // Poll rather than wait for a load event: `load` fires when the document is parsed, and
    // React mounts after that. What is being asserted is that it mounted at all.
    let state = null;
    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: PROBE,
        returnByValue: true,
      });
      state = JSON.parse(result.result.value);
      if (state.mounted > 0) break;
      await sleep(500);
    }

    const problems = cdp.events
      .filter((event) => event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
      .map((event) => `${event.params.entry.source}: ${event.params.entry.text}`);

    cdp.close();

    console.log(`• url      ${state.url}`);
    console.log(`• title    ${state.title}`);
    console.log(`• mounted  ${state.mounted} element(s) under #root`);
    console.log(`• text     ${state.text || '(nothing)'}`);
    console.log(`• visible  ${state.visible}`);
    for (const problem of problems) console.log(`• console  ${problem}`);

    if (state.mounted <= 0) {
      throw new Error('the window opened but the application never rendered — a blank window');
    }
    if (!state.visible) {
      throw new Error('the renderer is running but its window was never shown to the user');
    }
    // A policy that blocks the app's own bundle is worse than no policy, because it fails
    // only in the packaged build. Any violation here is a release blocker.
    const blocked = problems.filter((problem) => /Content Security Policy/i.test(problem));
    if (blocked.length > 0) {
      throw new Error(`the Content-Security-Policy blocked the app:\n  ${blocked.join('\n  ')}`);
    }

    console.log('✓ the packaged app launches and renders');
  } catch (error) {
    if (output.length > 0) console.error(`\n--- app output ---\n${output.join('')}`);
    console.error(`\n✗ ${error.message}`);
    stop();
    process.exit(1);
  }

  stop();
}

await main();
