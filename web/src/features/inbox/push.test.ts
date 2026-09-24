import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gql } from '~/sync/api';

import { DELETE_PUSH_SUBSCRIPTION, PUSH_CONFIG, REGISTER_PUSH_SUBSCRIPTION } from './operations';
import { enableThisDevice } from './push';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const gqlMock = vi.mocked(gql);

describe('enableThisDevice', () => {
  const subscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    subscribe.mockResolvedValue({
      endpoint: 'https://push.example/device',
      getKey: () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn().mockResolvedValue('granted'),
    });
    vi.stubGlobal('PushManager', function PushManager() {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn().mockResolvedValue({}),
        ready: Promise.resolve({ pushManager: { subscribe } }),
        getRegistration: vi.fn(),
      },
    });
  });

  it('subscribes with the install public key and registers the endpoint', async () => {
    gqlMock.mockImplementation(async (query: string) => {
      if (query === PUSH_CONFIG) return { pushConfig: { publicKey: 'AQ' } };
      return { registerPushSubscription: true };
    });

    await expect(enableThisDevice()).resolves.toBe('https://push.example/device');

    expect(subscribe).toHaveBeenCalledTimes(1);
    const options = subscribe.mock.calls[0]?.[0] as { userVisibleOnly: boolean };
    expect(options.userVisibleOnly).toBe(true);
    expect(gqlMock).toHaveBeenNthCalledWith(2, REGISTER_PUSH_SUBSCRIPTION, {
      input: {
        endpoint: 'https://push.example/device',
        p256dh: 'AQID',
        auth: 'AQID',
      },
    });
  });

  it('does not subscribe when this install has no key', async () => {
    gqlMock.mockResolvedValue({ pushConfig: { publicKey: null } });

    await expect(enableThisDevice()).rejects.toThrow(/not turned on/);
    expect(subscribe).not.toHaveBeenCalled();
    expect(gqlMock).toHaveBeenCalledWith(PUSH_CONFIG);
    expect(gqlMock).not.toHaveBeenCalledWith(DELETE_PUSH_SUBSCRIPTION, expect.anything());
  });
});
