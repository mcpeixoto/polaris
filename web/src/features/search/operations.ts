/**
 * Search's GraphQL, written here rather than in `~/gql/operations` because codegen scans
 * `src/**` and a feature's documents belong beside the code that sends them.
 *
 * There is one document, and it is a *query* rather than anything the store replays: search
 * is the one screen in the client whose answer cannot be computed locally. The replica holds
 * the workspace, but it does not hold the ranking — relevance is a GIN scan and a `ts_rank`
 * over folded text, and a client-side approximation of it would return a different order
 * from the one the API, the command menu and every integration return, which is exactly the
 * kind of disagreement the single filter grammar exists to prevent.
 *
 * The response types live in this file with the document deliberately. They are the wire
 * shape, and a field added to the query has to be added to the type in the same edit or the
 * screen reads `undefined` from a response that never carried it — a class of bug that
 * compiles, renders and only looks wrong.
 *
 * Two things about the field selection are decisions rather than habits:
 *
 * **`labels` is not requested, though the schema offers it.** `Issue.labels` is a plain
 * field on the server's generated model and `hydrateIssues` never fills it, so a query
 * selecting it gets `[]` for every issue rather than an error. Labels are replicated, so the
 * screen reads them from the store — which is where the rest of the row comes from anyway.
 *
 * **`state` and `assignee` are requested even though the replica has both.** They are the
 * fallback for a result the replica does not hold — a cold start, an issue that arrived in
 * the ranking before the delta carrying it did — so a search never renders a row with no
 * status on it. See `Search.tsx`, where the precedence rule is stated once.
 */

import type { StateCategory, UUID } from '~/store';

/**
 * Issues and comments in one round trip.
 *
 * Deliberately one request rather than two. They are ranked over the same tsquery and shown
 * on the same screen, and splitting them would put two spinners on one keystroke and make
 * "issues arrived, comments did not" a state the screen has to have an opinion about.
 */
export const SEARCH_QUERY = /* GraphQL */ `
  query Search($input: SearchInput!) {
    search(input: $input) {
      issueCount
      issues {
        id
        identifier
        title
        priority
        state {
          id
          name
          category
          color
        }
        assignee {
          id
          displayName
          avatarUrl
        }
      }
      comments {
        id
        issueId
        body
        createdAt
      }
    }
  }
`;

/**
 * What `search` takes.
 *
 * `first` is clamped by the server to 100 and defaults to 25, so nothing here should ever
 * ask for more — see `SEARCH_MAX_RESULTS` in `search.ts`, which is the client's copy of that
 * ceiling and the number the "show more" stops at.
 *
 * `filter` is the same AST saved views use, passed through untouched. That is the whole
 * reason it is `unknown` and not a shape restated here: `~/filter` owns the grammar, the
 * server compiles the same one, and a second definition on the way to the wire is how a
 * search and a view with identical filters come to return different issues.
 *
 * A type alias rather than an interface, and it has to be: `gql` takes its variables as
 * `Record<string, unknown>`, and TypeScript only gives an *alias* of an object type the
 * implicit index signature that satisfies it. Declared as an interface this fails to
 * compile at the call site, with an error that points at the call rather than at here.
 */
export type SearchVariables = {
  readonly input: {
    readonly query: string;
    readonly filter?: unknown;
    readonly teamId?: UUID;
    readonly first?: number;
    readonly includeArchived?: boolean;
  };
};

/** One issue as the ranking returns it. Enough to draw a row without the replica. */
export interface SearchIssue {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly priority: number;
  readonly state: {
    readonly id: UUID;
    readonly name: string;
    readonly category: StateCategory;
    readonly color: string;
  };
  /** Null for unassigned work, which is a real answer rather than a missing one. */
  readonly assignee: {
    readonly id: UUID;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  } | null;
}

/**
 * One comment.
 *
 * It names its issue by id and nothing else, because the schema's `Comment` has no `issue`
 * field — so the identifier the row links to is resolved from the replica. The bootstrap
 * stream carries comments and their issues, so this only fails on a replica that is still
 * filling, and the screen says so rather than linking somewhere that does not exist.
 */
export interface SearchComment {
  readonly id: UUID;
  readonly issueId: UUID;
  readonly body: string;
  readonly createdAt: string;
}

export interface SearchResults {
  readonly issues: readonly SearchIssue[];
  readonly comments: readonly SearchComment[];
  /**
   * Every issue that matched, before `first` cut the list — which is what lets the screen
   * say "25 of 412" rather than "25". Comments are deliberately not counted by the server,
   * so there is no equivalent number for them and the screen does not invent one.
   */
  readonly issueCount: number;
}

export interface SearchQueryData {
  readonly search: SearchResults;
}
