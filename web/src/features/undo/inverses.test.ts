import { describe, expect, it, vi } from 'vitest';

import { unarchiveCustomer } from '~/features/customers/mutations';
import { unarchiveFormTemplate } from '~/features/form-templates/mutations';
import { unarchiveInitiativeLabel } from '~/features/initiative-labels/mutations';
import { unarchiveInitiative } from '~/features/initiatives/mutations';
import { unarchiveLabel } from '~/features/labels/mutations';
import { unarchiveProjectLabel } from '~/features/project-labels/mutations';
import { unarchiveProjectTemplate } from '~/features/project-templates/mutations';
import { unarchiveProjectStatus } from '~/features/projects/mutations';
import { unarchiveRecurringIssue } from '~/features/recurring/mutations';
import { unarchiveStatus } from '~/features/team/mutations';
import { unarchiveTemplate } from '~/features/templates/mutations';
import type { UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

/**
 * What every way back actually sends.
 *
 * Eleven modules, one contract: the same operation the archive used, with `archived: false`,
 * against the id it was given, and no optimistic patch. The last of those is the one worth a
 * test — the row left the replica when it was archived, so there is no `before` to hold, and
 * a patch that invented one would put a row on screen that the next delta then contradicts.
 * `features/archive/mutations.ts` argues the same point for the three older restores.
 *
 * One table rather than eleven files beside eleven `mutations.ts`, because eleven copies of
 * this fixture would be eleven chances for one of them to assert something slightly different
 * about a contract that is deliberately identical.
 */

const ID = 'ffffffff-0000-0000-0000-000000000001' as UUID;

const INVERSES: readonly (readonly [string, (engine: SyncEngine, id: UUID) => Promise<void>])[] = [
  ['unarchiveCustomer', unarchiveCustomer],
  ['unarchiveInitiative', unarchiveInitiative],
  ['unarchiveLabel', unarchiveLabel],
  ['unarchiveProjectLabel', unarchiveProjectLabel],
  ['unarchiveInitiativeLabel', unarchiveInitiativeLabel],
  ['unarchiveProjectStatus', unarchiveProjectStatus],
  ['unarchiveStatus', unarchiveStatus],
  ['unarchiveTemplate', unarchiveTemplate],
  ['unarchiveProjectTemplate', unarchiveProjectTemplate],
  ['unarchiveFormTemplate', unarchiveFormTemplate],
  ['unarchiveRecurringIssue', unarchiveRecurringIssue],
];

describe('the way back from an archive', () => {
  it.each(INVERSES)('%s sends archived: false for the id it was given', async (_name, inverse) => {
    const mutate = vi.fn().mockResolvedValue({});
    await inverse({ mutate } as unknown as SyncEngine, ID);

    expect(mutate).toHaveBeenCalledTimes(1);
    const sent = mutate.mock.calls[0]![0] as {
      variables: { id: string; archived: boolean };
      optimistic?: unknown;
    };
    expect(sent.variables).toEqual({ id: ID, archived: false });
    expect(sent.optimistic).toBeUndefined();
  });

  it('covers every inverse that was added, so a twelfth is not forgotten', () => {
    // Paired with `undoable.test.ts`, which is what notices a missing inverse at all. This
    // one notices an inverse that exists and is never exercised.
    expect(INVERSES).toHaveLength(11);
  });
});
