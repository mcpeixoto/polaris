/**
 * Which sign-in providers this server offers, asked once per burst.
 *
 * The answer is a fact about the deployment, not about the visitor, and the sign-in and
 * sign-up screens both want it. Asking per mount means asking twice under React's strict
 * mode — which double-invokes effects on purpose — and again every time somebody toggles
 * between the two forms. Two identical requests are not a correctness problem, but they are
 * two round trips on the one screen whose whole job is to be fast and quiet, and the boot
 * check in `web/e2e/boot-console.spec.ts` counts them.
 *
 * Only the *in-flight* promise is shared, and it is dropped the moment it settles. Caching
 * the resolved value would be wrong in a different way: a deployment that gains a provider
 * would keep saying it has none for as long as the tab stayed open, and a failed request
 * would poison every retry.
 */

import { auth } from '~/sync/api';

type Answer = Awaited<ReturnType<typeof auth.providers>>;

let inflight: Promise<Answer> | null = null;

export function fetchAuthProviders(): Promise<Answer> {
  inflight ??= auth.providers().finally(() => {
    inflight = null;
  });
  return inflight;
}
