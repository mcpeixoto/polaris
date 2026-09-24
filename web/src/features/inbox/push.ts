/**
 * This browser as a push device.
 *
 * The inbox is the record and email is the digest. A phone is a third channel, and it
 * only exists after somebody on this device asks for it: iOS refuses Web Push from a
 * Safari tab, and every browser refuses it without a gesture. So nothing here runs on
 * mount. The settings screen calls in when a button is pressed.
 *
 * The service worker is `web/public/sw.js`. It is not bundled, and it does not handle
 * `fetch` — a worker that intercepts navigation becomes the page's network, and this
 * one only exists to show a banner and open the issue.
 */

import { DELETE_PUSH_SUBSCRIPTION, PUSH_CONFIG, REGISTER_PUSH_SUBSCRIPTION } from './operations';
import { gql } from '~/sync/api';

/**
 * What a phone receives until the person says otherwise.
 *
 * The same five as `defaultPushTypes` in services/internal/domain/notification_prefs.go.
 * A sixth here would buzz a phone for a type the screen claims is off.
 */
export const DEFAULT_PUSH = [
  'issue_assigned',
  'mention',
  'issue_priority_raised',
  'issue_blocked',
  'issue_due',
] as const;

export interface PushAvailability {
  readonly supported: boolean;
  /**
   * iOS delivers Web Push only to a site opened from the Home Screen. A tab can show
   * the button and still have the platform reject the subscription.
   */
  readonly needsHomeScreen: boolean;
}

/** What this browser can do, read synchronously so the screen can render before any request. */
export function pushAvailability(): PushAvailability {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, needsHomeScreen: false };
  }
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  if (!standalone && typeof window.matchMedia === 'function') {
    standalone = window.matchMedia('(display-mode: standalone)').matches;
  }
  return { supported, needsHomeScreen: ios && supported && !standalone };
}

/** The endpoint this browser already holds, or null. Local — it does not ask the server. */
export async function thisDeviceEndpoint(): Promise<string | null> {
  if (!pushAvailability().supported) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg === undefined) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

/**
 * Asks for permission, subscribes, and tells the server.
 *
 * The public key is fetched here rather than when the screen opens: a settings page
 * that queries on mount fails its tests against a network that is not there, and it
 * asks the server a question nobody has asked yet.
 */
export async function enableThisDevice(): Promise<string> {
  const availability = pushAvailability();
  if (availability.needsHomeScreen) {
    throw new Error(
      'On an iPhone, add Polaris to the Home Screen and open it from there. Safari will not deliver notifications to a tab.',
    );
  }
  if (!availability.supported) {
    throw new Error('This browser cannot receive notifications.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications stay off until this device allows them.');
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  const ready = await navigator.serviceWorker.ready;
  const active = ready.pushManager === undefined ? reg : ready;

  const data = await gql<{ pushConfig: { publicKey: string | null } }>(PUSH_CONFIG);
  const publicKey = data.pushConfig.publicKey;
  if (publicKey === null || publicKey === '') {
    throw new Error('This Polaris install has not turned on phone notifications.');
  }

  const sub = await active.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey(publicKey),
  });
  const p256dh = keyOf(sub, 'p256dh');
  const auth = keyOf(sub, 'auth');
  await gql(REGISTER_PUSH_SUBSCRIPTION, {
    input: { endpoint: sub.endpoint, p256dh, auth },
  });
  return sub.endpoint;
}

/** Drops this browser's subscription locally and on the server. */
export async function disableThisDevice(): Promise<void> {
  if (!pushAvailability().supported) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg === undefined ? null : await reg.pushManager.getSubscription();
  if (sub === null) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await gql(DELETE_PUSH_SUBSCRIPTION, { endpoint });
}

function keyOf(sub: PushSubscription, name: 'p256dh' | 'auth'): string {
  const raw = sub.getKey(name);
  if (raw === null) {
    throw new Error('This browser subscribed without a key, so it cannot be registered.');
  }
  return bytesToBase64Url(new Uint8Array(raw));
}

/** VAPID public keys travel as URL-safe base64; PushManager wants the raw bytes. */
function vapidKey(base64: string): ArrayBuffer {
  const bytes = base64UrlToBytes(base64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlToBytes(value: string): Uint8Array {
  const pad = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
