import { Matchup } from '../models/team.model';

export function involves(m: Matchup, teamId: number | null): boolean {
  return m.home.teamId === teamId || m.away.teamId === teamId;
}

// 1st, 2nd, 3rd, 4th, ..., 11th, 12th, 13th, 21st, ...
export function ordinal(n: number): string {
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  const isTeens = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${isTeens ? 'th' : (suffixes[n % 10] ?? 'th')}`;
}

// The user's own matchup goes first; the rest keep ESPN's order. Shared by the league page's
// tiles and the matchup view's switcher so both list matchups the same way.
export function mineFirst(matchups: Matchup[], myTeamId: number | null): Matchup[] {
  return [...matchups.filter((m) => involves(m, myTeamId)), ...matchups.filter((m) => !involves(m, myTeamId))];
}
