/**
 * The documents for saved views, per-view display preferences and favourites.
 *
 * Written here rather than in `~/gql/operations` because codegen scans `src/**` and a
 * feature's documents belong beside the code that sends them.
 *
 * `filter` and `display` are the `JSON` scalar on both sides, deliberately. A typed GraphQL
 * input and output tree for the filter grammar would be a *second* definition of it alongside
 * the compiler, which is precisely the trap `docs/03-architecture/06-filter-grammar.md` was
 * written to prevent: a filter that means one thing in a saved view and another in search.
 * The server validates the AST at the boundary and rejects anything it does not recognise —
 * including an unknown field, which is a hard error rather than an ignored clause, because
 * ignoring one silently widens the result set. The scalar takes a real JSON value rather than
 * a string, so these are sent as objects.
 *
 * The fragments select exactly the fields the store's interfaces hold, and
 * `web/src/gql/fragments.test.ts` fails the build when they drift. That is not pedantry: a
 * view fetched by a mutation response and the same view arriving as a delta have to land in
 * the store with identical shapes, or an option somebody just set disappears the next time
 * they rename it.
 */

export const VIEW_FIELDS = /* GraphQL */ `
  fragment ViewFields on View {
    id
    workspaceId
    teamId
    projectId
    ownerId
    name
    description
    icon
    color
    filter
    display
    position
    createdBy
    createdAt
    updatedAt
    archivedAt
  }
`;

export const VIEW_PREFERENCE_FIELDS = /* GraphQL */ `
  fragment ViewPreferenceFields on ViewPreference {
    id
    workspaceId
    userId
    viewKey
    display
    createdAt
    updatedAt
  }
`;

export const FAVORITE_FIELDS = /* GraphQL */ `
  fragment FavoriteFields on Favorite {
    id
    workspaceId
    userId
    kind
    targetId
    folderId
    name
    position
    createdAt
    updatedAt
  }
`;

export const CREATE_VIEW = /* GraphQL */ `
  ${VIEW_FIELDS}
  mutation CreateView($input: CreateViewInput!) {
    createView(input: $input) {
      version
      view {
        ...ViewFields
      }
    }
  }
`;

export const UPDATE_VIEW = /* GraphQL */ `
  ${VIEW_FIELDS}
  mutation UpdateView($input: UpdateViewInput!) {
    updateView(input: $input) {
      version
      view {
        ...ViewFields
      }
    }
  }
`;

export const DELETE_VIEW = /* GraphQL */ `
  mutation DeleteView($id: UUID!) {
    deleteView(id: $id) {
      version
      id
    }
  }
`;

/**
 * Display options for the views that have no row of their own — a team's issues, My Issues.
 *
 * Keyed by a string the client chooses rather than by an id, because the thing being
 * remembered has no id: "the ENG issue list" is a route, not an entity. On the server rather
 * than in localStorage, because the grouping you chose has to follow you to your other
 * machine — that is the whole reason this is a mutation and not a `setItem`.
 */
export const SET_VIEW_PREFERENCE = /* GraphQL */ `
  ${VIEW_PREFERENCE_FIELDS}
  mutation SetViewPreference($viewKey: String!, $display: JSON!) {
    setViewPreference(viewKey: $viewKey, display: $display) {
      version
      preference {
        ...ViewPreferenceFields
      }
    }
  }
`;

export const ADD_FAVORITE = /* GraphQL */ `
  ${FAVORITE_FIELDS}
  mutation AddFavorite($kind: FavoriteKind!, $targetId: UUID!, $afterFavoriteId: UUID) {
    addFavorite(kind: $kind, targetId: $targetId, afterFavoriteId: $afterFavoriteId) {
      version
      favorite {
        ...FavoriteFields
      }
    }
  }
`;

/**
 * Removal is by `(kind, targetId)` and not by id, which is the API's shape and worth knowing
 * before you look for a `removeFavorite(id:)` that does not exist. It also means the call is
 * naturally idempotent: un-favouriting something that is not favourited is not an error.
 */
export const REMOVE_FAVORITE = /* GraphQL */ `
  mutation RemoveFavorite($kind: FavoriteKind!, $targetId: UUID!) {
    removeFavorite(kind: $kind, targetId: $targetId) {
      version
      id
    }
  }
`;

export const CREATE_FAVORITE_FOLDER = /* GraphQL */ `
  ${FAVORITE_FIELDS}
  mutation CreateFavoriteFolder($name: String!, $afterFavoriteId: UUID) {
    createFavoriteFolder(name: $name, afterFavoriteId: $afterFavoriteId) {
      version
      favorite {
        ...FavoriteFields
      }
    }
  }
`;

export const UPDATE_FAVORITE_FOLDER = /* GraphQL */ `
  ${FAVORITE_FIELDS}
  mutation UpdateFavoriteFolder($id: UUID!, $name: String!) {
    updateFavoriteFolder(id: $id, name: $name) {
      version
      favorite {
        ...FavoriteFields
      }
    }
  }
`;

export const MOVE_FAVORITE = /* GraphQL */ `
  ${FAVORITE_FIELDS}
  mutation MoveFavorite($input: MoveFavoriteInput!) {
    moveFavorite(input: $input) {
      version
      favorite {
        ...FavoriteFields
      }
    }
  }
`;

export const VIEW_SUBSCRIPTION_FIELDS = /* GraphQL */ `
  fragment ViewSubscriptionFields on ViewSubscription {
    id
    workspaceId
    viewId
    userId
    added
    completed
    createdAt
    updatedAt
  }
`;

export const SET_VIEW_SUBSCRIPTION = /* GraphQL */ `
  ${VIEW_SUBSCRIPTION_FIELDS}
  mutation SetViewSubscription($input: SetViewSubscriptionInput!) {
    setViewSubscription(input: $input) {
      version
      viewSubscription {
        ...ViewSubscriptionFields
      }
    }
  }
`;

export const DELETE_VIEW_SUBSCRIPTION = /* GraphQL */ `
  mutation DeleteViewSubscription($viewId: UUID!) {
    deleteViewSubscription(viewId: $viewId) {
      version
      id
    }
  }
`;
