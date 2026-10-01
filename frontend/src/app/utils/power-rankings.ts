import { LineupSlot, Player, ScheduledMatchup } from '../models/team.model';

// Power rankings order teams by one strength figure, an expected weekly score, that blends how a
// team has scored with what its roster is projected to score now:
//   strength = w x results + (1 - w) x roster,   w = n / (n + RESULTS_WEIGHT_GAMES)
// where results is the team's points per completed week, roster its starters' projected total
// this week, and n its completed weeks. Early on the roster dominates; by midseason results do.
// The same strength drives playoff odds' simulated scores (utils/playoff-odds.ts).

// How many completed weeks it takes for results to count as much as the roster.
export const RESULTS_WEIGHT_GAMES = 4;

// A player's projection, from whichever source (and week) the strength is being built for.
export type StrengthProjectionOf = (player: Player) => number;

// The projected total of a team's starters. A starter projected at 0 (on bye, or ruled out) is
// swapped for the best bench player at the same position, so one bye week doesn't sink a team.
// Players on IR can't be started, so they're never swapped in.
export function rosterStrength(players: readonly Player[], projectionOf: StrengthProjectionOf): number {
  const bench = players
    .filter((p) => !p.starter && p.slot !== 'IR')
    .map((player) => ({ player, projected: projectionOf(player) }))
    .filter((b) => b.projected > 0)
    .sort((a, b) => b.projected - a.projected);
  const used = new Set<number>();

  return players
    .filter((p) => p.starter)
    .reduce((sum, p) => {
      const projected = projectionOf(p);
      if (projected > 0) return sum + projected;
      const sub = bench.find((b) => b.player.position === p.position && !used.has(b.player.playerId));
      if (!sub) return sum;
      used.add(sub.player.playerId);
      return sum + sub.projected;
    }, 0);
}

export interface LineupCandidate {
  playerId: number;
  position: string;
  projected: number;
}

// The projected total of the best starting lineup a set of players can field: the most restrictive
// slots (fewest eligible positions) are filled first, each with the best player left who can play
// it, so a FLEX takes whoever is left over once RB, WR and TE are set. Used for draft day, when
// there's no set lineup to go on.
export function bestLineupTotal(players: readonly LineupCandidate[], slots: readonly LineupSlot[]): number {
  const available = [...players].filter((p) => p.projected > 0).sort((a, b) => b.projected - a.projected);
  const used = new Set<number>();
  return [...slots]
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length)
    .flatMap((slot) => Array.from({ length: slot.count }, () => slot))
    .reduce((sum, slot) => {
      const pick = available.find((p) => !used.has(p.playerId) && slot.eligiblePositions.includes(p.position));
      if (!pick) return sum;
      used.add(pick.playerId);
      return sum + pick.projected;
    }, 0);
}

// Each team's score in every regular-season matchup before beforePeriod, in period order. Byes
// (no opponent) aren't scores.
export function completedScores(schedule: readonly ScheduledMatchup[], beforePeriod: number): Map<number, number[]> {
  const scores = new Map<number, number[]>();
  const add = (teamId: number, points: number) => scores.set(teamId, [...(scores.get(teamId) ?? []), points]);
  for (const m of schedule) {
    if (m.matchupPeriod >= beforePeriod || m.awayTeamId === null) continue;
    add(m.homeTeamId, m.homePoints);
    add(m.awayTeamId, m.awayPoints ?? 0);
  }
  return scores;
}

export interface StrengthParts {
  strength: number;
  results: number | null;
  roster: number | null;
  resultsWeight: number;
}

// A team's strength from its completed scores and its roster's projected total. With no roster
// (rosters failed to load) it's results alone; with neither, null.
export function teamStrength(scores: readonly number[], roster: number | null): StrengthParts | null {
  const n = scores.length;
  const results = n ? scores.reduce((sum, s) => sum + s, 0) / n : null;
  if (roster === null) return results === null ? null : { strength: results, results, roster, resultsWeight: 1 };
  const w = n / (n + RESULTS_WEIGHT_GAMES);
  return { strength: w * (results ?? 0) + (1 - w) * roster, results, roster, resultsWeight: w };
}

// movement is how many places a team has climbed since the previous ranking (negative for a fall),
// or null with no previous ranking.
export interface PowerRank {
  teamId: number;
  rank: number;
  strength: number;
  movement: number | null;
}

// Rank 1 is the strongest; equal strengths fall back to team id so the order is stable.
export function rankByStrength(strengths: ReadonlyMap<number, number>): Map<number, number> {
  const order = [...strengths.entries()].sort(([idA, a], [idB, b]) => b - a || idA - idB);
  return new Map(order.map(([teamId], i) => [teamId, i + 1] as const));
}

// Today's ranking, with movement against the previous one when there is one.
export function powerRankings(
  strengths: ReadonlyMap<number, number>,
  previous: ReadonlyMap<number, number> | null,
): PowerRank[] {
  const ranks = rankByStrength(strengths);
  const previousRanks = previous ? rankByStrength(previous) : null;
  return [...ranks.entries()]
    .map(([teamId, rank]) => {
      const before = previousRanks?.get(teamId);
      return { teamId, rank, strength: strengths.get(teamId)!, movement: before === undefined ? null : before - rank };
    })
    .sort((a, b) => a.rank - b.rank);
}
