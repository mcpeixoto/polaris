/**
 * Which of the workspace's users is the person at the keyboard.
 *
 * The replica holds every user in the workspace and no marker saying which one is you.
 * That is not an oversight: the sync stream carries workspace state, and "who is looking at
 * it" is a property of the session rather than of the data — a second tab signed in as
 * somebody else would otherwise be reading a replica that disagrees with its own cookie.
 *
 * So the id is asked for once per session and remembered here, and everything else is read
 * out of the store as usual. It matters in exactly the places where the product has to act
 * *as* somebody: the author of an optimistically posted comment, and the row in Members
 * that must not offer to demote or suspend the person clicking it.
 */

import { useEffect, useState } from 'react';

import { fromWireValue } from '~/gql/enums';
import { VIEWER_QUERY } from '~/gql/operations';
import type { User, UserRole, UUID } from '~/store';
import { currentWorkspace, gql } from '~/sync/api';
import { useLiveQuery } from './useLiveQuery';

interface ViewerResponse {
  readonly viewer: { readonly user: { readonly id: UUID; readonly role: string } };
}

/**
 * One request per workspace per page load, shared by every caller.
 *
 * Keyed by workspace because the answer is a different user in each one, and cached as the
 * promise rather than the result so that three screens mounting in the same frame make one
 * request between them instead of three.
 */
const pending = new Map<string, Promise<UUID | null>>();

/**
 * The viewer's role, kept beside the id rather than read back out of the replica.
 *
 * `useViewer` reads the profile from `store.users`, and a guest's replica has no `user`
 * rows at all — the directory is workspace-scoped and guests are not handed it (see
 * `sync.go`, "guests do not receive the directory"). So for the one person a role check
 * exists to exclude, `useViewer()` is permanently `null`, and every gate written as
 * "viewer is loaded and is not a guest" silently reads as "unknown" forever.
 *
 * The answer is already on the wire: `VIEWER_QUERY` selects the whole user, role
 * included. Keeping it here makes the role knowable for everybody, including the guest.
 */
const roles = new Map<string, UserRole>();

/**
 * The answers that have already arrived, so a later mount is synchronous.
 *
 * Without this, every screen that needs the viewer starts life not knowing who it is —
 * including on the tenth navigation of a session, long after the question was answered.
 * Actions gated on it (`i`, `⇧S`) are registered disabled for that window and swallow the
 * keystroke silently, on a screen that looks completely ready. It is a small window on a
 * developer's machine and a wide one on a loaded CI runner, which is where it was caught.
 */
const resolved = new Map<string, UUID | null>();

function viewerIdFor(workspaceId: string): Promise<UUID | null> {
  const existing = pending.get(workspaceId);
  if (existing !== undefined) return existing;

  const request = gql<ViewerResponse>(VIEWER_QUERY)
    .then((data) => {
      resolved.set(workspaceId, data.viewer.user.id);
      roles.set(workspaceId, fromWireValue(data.viewer.user.role) as UserRole);
      return data.viewer.user.id;
    })
    .catch(() => {
      // A failure is not cached. The usual cause is the network, and a client that gave up
      // on knowing who it is for the rest of the session would keep posting comments signed
      // by nobody long after it came back.
      pending.delete(workspaceId);
      return null;
    });

  pending.set(workspaceId, request);
  return request;
}

/**
 * Asks for the viewer's id ahead of the screen that needs it.
 *
 * Called once the replica is open, so that the first render of the first screen already
 * has an answer instead of racing one.
 */
export function prefetchViewerId(workspaceId: string): void {
  void viewerIdFor(workspaceId);
}

/** The signed-in user's id, or null until the answer arrives. */
export function useViewerId(): UUID | null {
  const workspaceId = currentWorkspace();
  const [id, setId] = useState<UUID | null>(() =>
    workspaceId === null ? null : (resolved.get(workspaceId) ?? null),
  );

  useEffect(() => {
    if (workspaceId === null) return;
    let live = true;
    void viewerIdFor(workspaceId).then((resolved) => {
      if (live) setId(resolved);
    });
    return () => {
      live = false;
    };
  }, [workspaceId]);

  return id;
}

/**
 * The signed-in user's role, or null until the session query has answered.
 *
 * Use this — never `useViewer()?.role` — for anything that has to be withheld from a
 * guest. The profile comes from the replica and a guest's replica holds no users, so a
 * guest reads as "not loaded yet" for the whole session there; this comes from the
 * session query, which answers for everybody.
 */
export function useViewerRole(): UserRole | null {
  const workspaceId = currentWorkspace();
  const [role, setRole] = useState<UserRole | null>(() =>
    workspaceId === null ? null : (roles.get(workspaceId) ?? null),
  );

  useEffect(() => {
    if (workspaceId === null) return;
    let live = true;
    void viewerIdFor(workspaceId).then(() => {
      if (live) setRole(roles.get(workspaceId) ?? null);
    });
    return () => {
      live = false;
    };
  }, [workspaceId]);

  return role;
}

/**
 * The signed-in user's profile, read from the replica so a rename made in another session
 * shows up here without asking anybody.
 */
export function useViewer(): User | null {
  const id = useViewerId();
  return useLiveQuery(
    (store) => (id === null ? null : (store.users.get(id) ?? null)),
    ['user'],
    [id],
  );
}
