import { LineupSlot, Player, ScheduledMatchup } from '../models/team.model';
import { rosterValue } from './lineup';

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

// The best-lineup total behind draft day and later weeks' strengths now lives with the lineup
// optimizer.
export { bestLineupTotal, slotFillOrder } from './lineup';
export type { LineupCandidate } from './lineup';

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

// A team's strength in each of the weeks (NFL weeks), from its completed scores blended with that
// week's roster projection. This week (thisWeek, when it's one of them) uses the set lineup; later
// weeks the best lineup the roster (IR aside) can field that week, since lineups get reset, so byes
// count in the week they fall. Without lineup settings, later weeks use the set lineup too.
export function teamWeeklyStrengths(
  players: readonly Player[],
  scores: readonly number[],
  weeks: readonly number[],
  slots: readonly LineupSlot[],
  futureProjectionOf: (player: Player, week: number) => number,
  thisWeek: { week: number; projectionOf: StrengthProjectionOf } | null,
): Map<number, number> {
  const later = weeks.filter((w) => w !== thisWeek?.week);
  const best = slots.length ? rosterValue(players, slots, later, futureProjectionOf).byWeek : null;
  const byWeek = new Map<number, number>();
  for (const w of weeks) {
    const roster =
      thisWeek && w === thisWeek.week ? rosterStrength(players, thisWeek.projectionOf)
      : best ? best.get(w)!
      : rosterStrength(players, (p) => futureProjectionOf(p, w));
    const parts = teamStrength(scores, roster);
    if (parts) byWeek.set(w, parts.strength);
  }
  return byWeek;
}

// A team's strength in each matchup period: the average over the period's NFL weeks that have one.
// Periods with none are left out.
export function periodStrengthsOf(
  byWeek: ReadonlyMap<number, number>,
  scoringPeriodsByMatchupPeriod: Readonly<Record<string, readonly number[]>>,
): Record<number, number> {
  const byPeriod: Record<number, number> = {};
  for (const [period, weeks] of Object.entries(scoringPeriodsByMatchupPeriod)) {
    const values = weeks.map((w) => byWeek.get(w)).filter((v): v is number => v !== undefined);
    if (values.length) byPeriod[Number(period)] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return byPeriod;
}

// The average strength of each team's remaining regular-season opponents (matchup periods from
// fromPeriod on), each taken in the period they meet. Teams with no games left are left out.
export function remainingScheduleStrength(
  schedule: readonly ScheduledMatchup[],
  fromPeriod: number,
  strengthIn: (teamId: number, period: number) => number,
): Map<number, number> {
  const faced = new Map<number, number[]>();
  const add = (teamId: number, opponentStrength: number) =>
    faced.set(teamId, [...(faced.get(teamId) ?? []), opponentStrength]);
  for (const m of schedule) {
    if (m.matchupPeriod < fromPeriod || m.awayTeamId === null) continue;
    add(m.homeTeamId, strengthIn(m.awayTeamId, m.matchupPeriod));
    add(m.awayTeamId, strengthIn(m.homeTeamId, m.matchupPeriod));
  }
  return new Map([...faced].map(([teamId, s]) => [teamId, s.reduce((a, b) => a + b, 0) / s.length] as const));
}

// movement is how many places a team has climbed since the previous ranking (negative for a fall),
// or null with no previous ranking. score is the team's strength as a share of the top team's, out
// of 100 (see powerScores).
export interface PowerRank {
  teamId: number;
  rank: number;
  strength: number;
  score: number;
  movement: number | null;
}

// Each team's power score: its strength as a percentage of the strongest team's, so the top team is
// 100 and a team on 87 projects to score 87% of what the leader does in a week. 0 for every team if
// none has a positive strength.
export function powerScores(strengths: ReadonlyMap<number, number>): Map<number, number> {
  const top = Math.max(0, ...strengths.values());
  return new Map([...strengths].map(([teamId, s]) => [teamId, top > 0 ? (100 * Math.max(0, s)) / top : 0] as const));
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
  const scores = powerScores(strengths);
  const previousRanks = previous ? rankByStrength(previous) : null;
  return [...ranks.entries()]
    .map(([teamId, rank]) => {
      const before = previousRanks?.get(teamId);
      return {
        teamId,
        rank,
        strength: strengths.get(teamId)!,
        score: scores.get(teamId)!,
        movement: before === undefined ? null : before - rank,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}
