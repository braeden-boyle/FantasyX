import { HistoryWeek } from '../models/team.model';

// FantasyX's weekly projection: ESPN's, corrected by how far off ESPN has been for the player this
// season, and optionally by how their position has fared against defenses ranked like this week's
// opponent:
//   fantasyx = espn + bias + slope(position) x rank offset
// Both terms only ever look at weeks before the one being projected, so past weeks show what
// FantasyX would have projected at the time. The backtest below measures each term against ESPN
// over every rostered player-week this season. See docs/PLAN.md, v1.7.

// How many games of "ESPN was right" a player's own average miss is weighed against. With 1-3
// games the bias stays small and FantasyX sits close to ESPN, which is the honest answer. Tuned on a
// live 14-team league after week 3 (572 player-weeks): ESPN showed no per-player or per-position
// bias yet, and every smaller value did worse than ESPN; at 20 FantasyX matched it (MAE 5.365 vs
// 5.364). Revisit mid-season, when players have enough games for a bias to show.
export const BIAS_SHRINKAGE_GAMES = 20;

// Ridge penalty on the per-position rank slope, in player-weeks at the most extreme rank. Keeps
// the slope near 0 until the league has enough weeks against a spread of defenses.
export const RANK_SHRINKAGE = 20;

// Whether FantasyX projections include the opponent-rank term. The ranks are ESPN's current ones,
// not the rank as it stood each week, so the backtest flatters this term. After week 3 it cut MAE
// about 3.5% (5.18 vs 5.36), but with only 3 games per defense the current ranks are mostly built
// from the very games being predicted, so that gain is largely leak. Off until it holds up later
// in the season, when a week's result moves a defense's rank much less.
export const USE_RANK_TERM = false;

const RANKED_TEAMS = 32;

export type PlayerHistories = ReadonlyMap<number, readonly HistoryWeek[]>;
export type PlayerPositions = ReadonlyMap<number, string>;

export interface ErrorSummary {
  mae: number;
  rmse: number;
}

export interface Backtest {
  espn: ErrorSummary;
  bias: ErrorSummary;
  biasRank: ErrorSummary;
  playerWeeks: number;
}

// A player's average miss against ESPN (actual - projected) over the weeks before beforeWeek,
// shrunk toward 0: n x mean / (n + k).
export function playerBias(weeks: readonly HistoryWeek[], beforeWeek = Infinity): number {
  let n = 0;
  let total = 0;
  for (const w of weeks) {
    if (w.week >= beforeWeek) continue;
    n++;
    total += w.actual - w.projected;
  }
  return total / (n + BIAS_SHRINKAGE_GAMES);
}

// The opponent's rank against the position, scaled to [-1, 1] (null when unknown).
export function rankOffset(rank: number | null | undefined): number | null {
  if (!rank) return null;
  const middle = (RANKED_TEAMS + 1) / 2;
  return (rank - middle) / (middle - 1);
}

// ESPN's projection with the corrections added. A player ESPN projects at 0 (ruled out, or no
// game) stays at 0, and the corrections never take a projection below 0.
export function customProjection(espn: number, bias: number, slope: number, rank: number | null | undefined): number {
  if (espn <= 0) return 0;
  const offset = rankOffset(rank);
  return Math.max(0, espn + bias + (offset === null ? 0 : slope * offset));
}

export interface FantasyXModel {
  // FantasyX's projection for a player's week, from their history before that week only.
  project(playerId: number, position: string, week: number, espn: number, rank: number | null | undefined): number;
}

interface RankPoint {
  week: number;
  position: string;
  offset: number;
  residual: number;
}

// Per-position slope of the bias-corrected miss on the rank offset, fitted (ridge, through 0) on
// every player-week before beforeWeek, pooled across the league.
function rankSlopes(points: readonly RankPoint[], beforeWeek: number): Map<string, number> {
  const sums = new Map<string, { xr: number; xx: number }>();
  for (const p of points) {
    if (p.week >= beforeWeek) continue;
    const s = sums.get(p.position) ?? { xr: 0, xx: 0 };
    s.xr += p.offset * p.residual;
    s.xx += p.offset * p.offset;
    sums.set(p.position, s);
  }
  return new Map([...sums].map(([position, s]) => [position, s.xr / (s.xx + RANK_SHRINKAGE)] as const));
}

export function buildModel(
  histories: PlayerHistories,
  positions: PlayerPositions,
  useRankTerm = USE_RANK_TERM,
): FantasyXModel {
  // Each past week's miss after the bias FantasyX had at the time, for fitting the rank slopes.
  const points: RankPoint[] = [];
  if (useRankTerm) {
    for (const [playerId, weeks] of histories) {
      const position = positions.get(playerId);
      if (!position) continue;
      for (const w of weeks) {
        const offset = rankOffset(w.opponentPositionRank);
        if (offset === null) continue;
        points.push({ week: w.week, position, offset, residual: w.actual - w.projected - playerBias(weeks, w.week) });
      }
    }
  }

  const slopesByWeek = new Map<number, Map<string, number>>();
  const slopesBefore = (week: number) => {
    let slopes = slopesByWeek.get(week);
    if (!slopes) {
      slopes = rankSlopes(points, week);
      slopesByWeek.set(week, slopes);
    }
    return slopes;
  };

  return {
    project(playerId, position, week, espn, rank) {
      const bias = playerBias(histories.get(playerId) ?? [], week);
      const slope = useRankTerm ? (slopesBefore(week).get(position) ?? 0) : 0;
      return customProjection(espn, bias, slope, rank);
    },
  };
}

// A player's misses (actual - projection) this season, against ESPN's projections or, given a
// model, against what FantasyX projected at the time.
export function residuals(
  playerId: number,
  position: string,
  weeks: readonly HistoryWeek[],
  model: FantasyXModel | null,
): number[] {
  return weeks.map(
    (w) =>
      w.actual -
      (model ? model.project(playerId, position, w.week, w.projected, w.opponentPositionRank) : w.projected),
  );
}

function summarize(errors: readonly number[]): ErrorSummary {
  if (errors.length === 0) return { mae: 0, rmse: 0 };
  const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  return { mae, rmse };
}

// Walk-forward comparison over every player-week: each week is projected from earlier weeks only,
// then compared with what the player scored.
export function backtest(histories: PlayerHistories, positions: PlayerPositions): Backtest {
  const biasModel = buildModel(histories, positions, false);
  const rankModel = buildModel(histories, positions, true);
  const espn: number[] = [];
  const bias: number[] = [];
  const biasRank: number[] = [];

  for (const [playerId, weeks] of histories) {
    const position = positions.get(playerId) ?? '';
    espn.push(...residuals(playerId, position, weeks, null));
    bias.push(...residuals(playerId, position, weeks, biasModel));
    biasRank.push(...residuals(playerId, position, weeks, rankModel));
  }

  return { espn: summarize(espn), bias: summarize(bias), biasRank: summarize(biasRank), playerWeeks: espn.length };
}
