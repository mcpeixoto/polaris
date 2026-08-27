/**
 * The workspace audit log screen.
 *
 * This file is core (AGPL) and holds no part of the audit log itself: the header, the
 * explanation and the entitlement gate are here, and the listing comes from `@ee/audit` —
 * which resolves to the commercial module in an enterprise build and to a stub that says so
 * in a community one. See web/edition.ts.
 *
 * The screen exists in both editions on purpose. The rule the administration screens follow
 * is that a gated control is disabled with a reason, never hidden: an admin on a plan without
 * the audit log should find the page, learn that the product has one, and read what it would
 * record. Hiding it means the feature is discovered from a pricing page or not at all, and it
 * means somebody who assumed they had an audit trail finds out during the incident.
 */

import { AuditLogPanel } from '@ee/audit';

import { featureBlock, useEntitlements } from '~/features/admin/entitlements';
import styles from './AuditLog.module.css';

export function AuditLog() {
  const entitlements = useEntitlements();
  const blocked = featureBlock(entitlements, 'auditLog');

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Audit log</h1>
      </header>

      <div className={styles.body}>
        <section className={styles.intro} aria-labelledby="audit-about">
          <h2 className={styles.sectionTitle} id="audit-about">
            What is recorded
          </h2>
          <p className={styles.sectionHint}>
            Sign-ins, invitations sent and accepted, role changes, suspensions and removals, API
            keys created and revoked, workspace settings, and any change to whether a team is
            private. Entries are permanent and cannot be edited — not from this screen and not from
            the database. Payloads never contain a credential: an API key appears by name and
            prefix, never by its token.
          </p>
        </section>

        {/* role="status" and not role="alert": a plan that does not include a feature is not
            an error the reader made, and an assertive announcement treats it as one. This is
            the same distinction SlaSettings draws. */}
        {blocked === null ? null : (
          <p className={styles.error} role="status">
            {blocked}
          </p>
        )}

        {/* Rendered even when blocked is null-but-unknown, which is the case on a cold load:
            `featureBlock` deliberately does not treat an unknown answer as denied, so the
            panel asks and the server refuses with its own message if it must. Only a
            confirmed refusal keeps the query from being sent at all. */}
        {blocked === null ? <AuditLogPanel /> : null}
      </div>
    </div>
  );
}
