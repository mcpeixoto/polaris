// The community build's `@ee/audit`.
//
// AGPL, and it is the whole of what the community bundle contains on the subject. The
// commercial module at ee/web/audit is not merely inactive here — it is not in the bundle,
// because `@ee` resolves to this directory and Rollup never sees the other one. That is the
// same claim the Go side makes with `//go:build ee`, made the way a bundler can make it.
//
// This file is also the TYPE CONTRACT for both editions. tsconfig.json pins `@ee/*` here,
// so `pnpm typecheck` checks every core caller against these signatures; tsconfig.ee.json
// re-points the mapping and checks the commercial module against its own callers. What the
// two must agree on is exactly what is exported below — which is why this stub declares the
// props properly instead of taking `any` and rendering a message.

import { EmptyState } from '~/components';

export interface AuditLogPanelProps {
  /**
   * How many entries to fetch per page. The server clamps this too; the number here is a
   * preference, not a promise.
   */
  readonly pageSize?: number;
}

/**
 * Stands in for the audit log in a build that does not contain one.
 *
 * It says so, rather than rendering an empty table. Those are different facts and only one
 * of them is true: an empty audit log reads as "nothing has happened", and on this screen
 * that is the answer a reader would act on. The server refuses the same request for the same
 * reason — see domain.ListAuditLog, which returns a message rather than an empty page when
 * the recorder is nil.
 */
export function AuditLogPanel(_props: AuditLogPanelProps) {
  return (
    <EmptyState
      title="Not included in this build"
      description="The audit log is an enterprise feature and is not part of the community edition of Polaris. This build does not contain it, so there is nothing here to show or to switch on."
    />
  );
}
