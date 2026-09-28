import { Matchup } from '../models/team.model';

export function involves(m: Matchup, teamId: number | null): boolean {
  return m.home.teamId === teamId || m.away.teamId === teamId;
}

// The user's own matchup goes first; the rest keep ESPN's order. Shared by the league page's
// tiles and the matchup view's switcher so both list matchups the same way.
export function mineFirst(matchups: Matchup[], myTeamId: number | null): Matchup[] {
  return [...matchups.filter((m) => involves(m, myTeamId)), ...matchups.filter((m) => !involves(m, myTeamId))];
}
