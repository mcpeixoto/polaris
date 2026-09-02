/**
 * Creating a team, and putting people in it.
 *
 * A team is the one entity in this product that cannot be created optimistically. Every
 * other create mints a plausible stand-in and reconciles it — an issue, a label, a status —
 * because the client already knows what the row will look like. A team does not: the server
 * assigns the timezone, the estimate scale, both cycle cadences, the triage flags, the two
 * auto-close windows and, crucially, a full set of workflow statuses that exist as separate
 * rows. A stand-in for that is a team with no statuses, which is a team no issue can be
 * filed into, drawn for however long the round trip takes.
 *
 * So this awaits, and the row arrives by the delta stream the same way it arrives for
 * everybody else in the workspace. The dialog spends that time with its button spinning,
 * which is honest: creating a team is a rare, deliberate act and not a keystroke.
 */

import { CREATE_TEAM } from '~/gql/operations';
import { fromWire, toWire } from '~/gql/enums';
import type { Team, TeamRole, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ADD_TEAM_MEMBER, REMOVE_TEAM_MEMBER } from './operations';

export interface NewTeam {
  /** The prefix on every identifier the team will ever mint. Upper case, letters first. */
  readonly key: string;
  readonly name: string;
  /** A private team is invisible to everyone who is not in it. */
  readonly private?: boolean | undefined;
  /** When set, the new team is a sub-team of this one. */
  readonly parentTeamId?: UUID | undefined;
}

/** The longest key the server will take, and what the field's maxLength must agree with. */
export const MAX_TEAM_KEY_LENGTH = 6;

/**
 * Creates the team and hands back the server's row.
 *
 * The caller wants the row rather than a void, because the only sensible thing to do after
 * creating a team is to go to it, and going to it needs the key the server settled on.
 */
export async function createTeam(engine: SyncEngine, input: NewTeam): Promise<Team> {
  const data = await engine.mutate<{ createTeam: { team: Team } }>({
    mutation: CREATE_TEAM,
    variables: {
      input: {
        key: input.key.trim().toUpperCase(),
        name: input.name.trim(),
        ...(input.private === true ? { private: true } : null),
        ...(input.parentTeamId === undefined ? null : { parentTeamId: input.parentTeamId }),
      },
    },
  });

  // The response spells enums the GraphQL way; every reader in the client compares against
  // the lower-case union. See gql/enums.ts — this is the same boundary, not a new one.
  return fromWire('team', data.createTeam.team);
}

/**
 * Puts somebody on a team.
 *
 * No optimistic patch, for a reason worth stating rather than assuming: the id of a
 * membership belongs to the server, and a stand-in row would have to be paired with the
 * real one on the way back. The delta stream carries the membership within a frame or two
 * of the commit anyway, and adding somebody to a team is a deliberate act — the row
 * appearing a moment after the click is not the same problem as a keystroke lagging.
 *
 * The early return is the part that matters: sending it twice is answered with the same
 * membership, and a caller adding six people from a picker will bounce off a name already
 * on the list.
 */
export async function addTeamMember(
  engine: SyncEngine,
  teamId: UUID,
  userId: UUID,
  role: TeamRole = 'member',
): Promise<void> {
  const store = engine.store;

  // Already on the team. Sending it again would be answered with the same membership and a
  // second stand-in for a row that is already here.
  for (const membershipId of store.membershipIdsForTeam(teamId)) {
    if (store.teamMemberships.get(membershipId)?.userId === userId) return;
  }

  await engine.mutate({
    mutation: ADD_TEAM_MEMBER,
    variables: { teamId, userId, role: toWire(role) },
  });
}

/**
 * Takes somebody off a team.
 *
 * Not optimistic, and for the reason `archiveStatus` is not: the server refuses to remove
 * the last owner of a team, and that refusal is the answer the user needs. A row that
 * vanished and came back is a puzzle; a row that stays put with the reason beside it is an
 * instruction.
 */
export async function removeTeamMember(
  engine: SyncEngine,
  teamId: UUID,
  userId: UUID,
): Promise<void> {
  await engine.mutate({
    mutation: REMOVE_TEAM_MEMBER,
    variables: { teamId, userId },
  });
}

/**
 * A key suggested from the name, the way the person would have typed it.
 *
 * Two words become their initials, one word becomes its first letters — "Design Systems" is
 * DS and "Platform" is PLAT — because that is what people reach for and typing over a
 * suggestion is cheaper than typing into an empty box. It is only ever a suggestion: the
 * field stays editable and the server has the final say about collisions.
 *
 * Returns '' when the name has no letters in it at all. The caller must treat that as "no
 * suggestion" rather than as a value — a form that posts an empty key gets a refusal about
 * a field the user was never shown a problem on.
 */
export function suggestTeamKey(name: string): string {
  const words = name
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word !== '' && /^[A-Za-z]/u.test(word));
  if (words.length === 0) return '';

  const key =
    words.length === 1
      ? (words[0] ?? '').slice(0, 4)
      : words
          .slice(0, MAX_TEAM_KEY_LENGTH)
          .map((word) => word[0] ?? '')
          .join('');

  return key.toUpperCase();
}

/**
 * What is wrong with a key, or null when nothing is.
 *
 * Checked here rather than in the dialog so the rule has one home: the server enforces the
 * same thing and the point of the client check is only to say so before the round trip.
 */
export function teamKeyProblem(key: string, taken: readonly string[]): string | null {
  const value = key.trim().toUpperCase();
  if (value === '') return 'A team needs a key. It goes in front of every issue identifier.';
  if (!/^[A-Z][A-Z0-9]*$/u.test(value)) return 'Letters and digits only, starting with a letter.';
  if (value.length > MAX_TEAM_KEY_LENGTH) {
    return `At most ${String(MAX_TEAM_KEY_LENGTH)} characters — it is repeated on every issue.`;
  }
  if (taken.includes(value)) return `${value} already belongs to another team.`;
  return null;
}
