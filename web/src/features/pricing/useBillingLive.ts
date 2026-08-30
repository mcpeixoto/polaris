/**
 * Whether the server this page is served from can take a payment.
 *
 * Answered by `GET /billing/config`, which is anonymous and returns one boolean — no price
 * ids, no keys. The pricing and landing pages are rendered for people with no session, so
 * this cannot come through the sync engine or a GraphQL query.
 *
 * Starts false and stays false on any failure. Failing towards "cannot buy" keeps the page
 * honest when the API is unreachable: the worst outcome is a visitor told to write to us on
 * a server that could in fact have sold to them, which is a mail; the opposite failure is a
 * checkout button that 400s on a deployment with no Stripe account behind it.
 */

import { useEffect, useState } from 'react';

import { billing } from '~/sync/api';

export function useBillingLive(): boolean {
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    billing
      .configured()
      .then((enabled) => {
        if (!cancelled) setLive(enabled);
      })
      .catch(() => {
        // Deliberately silent. An unreachable API is not something a marketing page should
        // report, and the false default is already the safe answer.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return live;
}
