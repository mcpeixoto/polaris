import { describe, expect, it } from 'vitest';

import { CLIENT_SCHEMA } from './db';
import { ENTITY_TYPES } from './types';

/**
 * The set of stores a v54 replica has.
 *
 * The database's name carries the schema number, so a bump is how an old replica gets
 * thrown away and rebuilt. That works right up until somebody adds an entity type and
 * leaves the number alone: the new build then opens a database created without the new
 * store, names it in every transaction, and IndexedDB refuses the transaction outright.
 * That shipped once (`reaction`, v53) and it did not degrade the app, it closed it.
 *
 * So the list is written down. Changing ENTITY_TYPES without bumping CLIENT_SCHEMA fails
 * here, in the client's own suite, seconds after the edit — rather than in a browser that
 * has been open since before the deploy.
 */
const STORES_AT: Readonly<Record<number, readonly string[]>> = {
  54: [
    'workspace',
    'user',
    'githubConnection',
    'githubUserLink',
    'gitlabConnection',
    'gitlabUserLink',
    'team',
    'teamMembership',
    'sentryConnection',
    'slackConnection',
    'cycleCalendarFeed',
    'workflowState',
    'customer',
    'slaRule',
    'dashboard',
    'dashboardTile',
    'label',
    'issueTemplate',
    'formTemplate',
    'formTemplateField',
    'askForm',
    'projectTemplate',
    'projectTemplateMilestone',
    'projectTemplateIssue',
    'projectStatus',
    'project',
    'projectTeam',
    'projectMember',
    'projectMilestone',
    'initiative',
    'initiativeProject',
    'initiativeUpdate',
    'initiativeLabel',
    'initiativeLabelLink',
    'initiativeRelation',
    'projectUpdate',
    'pulseFeed',
    'projectDependency',
    'projectLabel',
    'projectLabelLink',
    'cycle',
    'recurringIssue',
    'issue',
    'customerRequest',
    'issueLabel',
    'issueRelation',
    'attachment',
    'document',
    'comment',
    'reaction',
    'issueSubscription',
    'notification',
    'view',
    'viewSubscription',
    'projectSubscription',
    'initiativeSubscription',
    'customerSubscription',
    'viewPreference',
    'favorite',
  ],
};

describe('the replica schema pin', () => {
  it('has a recorded store list for the schema this build claims', () => {
    expect(
      STORES_AT[CLIENT_SCHEMA],
      `CLIENT_SCHEMA is ${CLIENT_SCHEMA} and this test has no store list for it. If you ` +
        'bumped the schema, add the new list here (and drop the old entry). If you added ' +
        'an entity type without bumping, that is the bug: every replica built before your ' +
        'change is missing the store, and the workspace will not open.',
    ).toBeDefined();
  });

  it('matches the entity types this build reads and writes', () => {
    expect(
      [...ENTITY_TYPES].sort(),
      'ENTITY_TYPES changed. Bump CLIENT_SCHEMA in db.ts and ClientSchemaVersion in ' +
        'services/internal/domain/sync.go together, then record the new list above — a ' +
        'store added under an unchanged schema number is a dead app for everyone who ' +
        'has opened Polaris before.',
    ).toEqual([...(STORES_AT[CLIENT_SCHEMA] ?? [])].sort());
  });
});
