import { MatchupTeam, Player, PlayerSpread } from '../models/team.model';

// Each side's chance of winning a matchup, from a normal approximation of the final margin:
//   expected = points so far + each starter's projection still to be scored
//   variance = sum over starters of (fraction of their game left) x (their swing)^2, leaving out
//              starters projected at 0 (ESPN zeroes the projection of a player ruled out)
// A starter's swing is how far their weekly points have landed from ESPN's projection this season,
// pulled toward a position default while they have few games.

// Typical miss between a player's weekly points and ESPN's projection, by position. Placeholders
// to be tuned against a live league (see docs/PLAN.md, v1.6).
export const POSITION_DEFAULT_SPREAD: Readonly<Record<string, number>> = {
  QB: 7.5,
  RB: 7,
  WR: 7.5,
  TE: 6,
  K: 4.5,
  'D/ST': 6.5,
};
const UNKNOWN_POSITION_SPREAD = 7;

// How many games of the default a player's own history is weighed against.
export const SHRINKAGE_GAMES = 4;

// Rough length of an NFL game, used to guess how much of an in-progress game is left.
export const GAME_LENGTH_MS = (3 * 60 + 15) * 60 * 1000;

// The bar colours a side green at or above this percentage, red at or below LOSING_AT_PERCENT, and
// neutral in between. Compared with the percentage the bar shows (to the tenth), so colour and label
// agree: 59.9% is neutral, 60.0% green.
export const WINNING_AT_PERCENT = 60;
export const LOSING_AT_PERCENT = 40;

// settled is true once every starter on both sides has finished their game (or has none), so the
// result is final rather than a very likely outcome.
export interface WinProbability {
  team: number;
  opponent: number;
  settled: boolean;
}

export type BarTone = 'neutral' | 'winning' | 'losing';

export function playerSpread(position: string, stats?: PlayerSpread | null): number {
  const fallback = POSITION_DEFAULT_SPREAD[position] ?? UNKNOWN_POSITION_SPREAD;
  const n = stats?.gamesUsed ?? 0;
  const mse = stats?.meanSquaredError ?? 0;
  return Math.sqrt((n * mse + SHRINKAGE_GAMES * fallback ** 2) / (n + SHRINKAGE_GAMES));
}

// Whether the player has nothing left to play this week: their game is final, or they have none.
export function gameDone(player: Player): boolean {
  return player.gameFinal || !player.opponent || !player.gameTimeUtc;
}

// How much of the player's game is still to be played: 1 before kickoff, 0 once final or with no
// game this week, and in between a straight-line guess from the time since kickoff.
export function remainingFraction(player: Player, now: Date): number {
  if (gameDone(player) || !player.gameTimeUtc) return 0;
  const elapsed = now.getTime() - new Date(player.gameTimeUtc).getTime();
  if (elapsed <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - elapsed / GAME_LENGTH_MS));
}

// Pass null spreads to use position defaults for everyone (e.g. when they failed to load).
export function winProbability(
  team: MatchupTeam,
  opponent: MatchupTeam,
  spreads: ReadonlyMap<number, PlayerSpread> | null,
  now: Date,
): WinProbability {
  const outlook = (side: MatchupTeam) =>
    side.team.players
      .filter((p) => p.starter)
      .reduce(
        (acc, p) => {
          if (p.projectedPoints <= 0) return acc;
          const left = remainingFraction(p, now);
          return {
            expected: acc.expected + p.projectedPoints * left,
            variance: acc.variance + left * playerSpread(p.position, spreads?.get(p.playerId)) ** 2,
          };
        },
        { expected: side.points, variance: 0 },
      );

  const mine = outlook(team);
  const theirs = outlook(opponent);
  const margin = mine.expected - theirs.expected;
  const variance = mine.variance + theirs.variance;

  const p = variance > 0 ? normalCdf(margin / Math.sqrt(variance)) : margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const settled = [team, opponent].every((side) => side.team.players.every((p) => !p.starter || gameDone(p)));
  return { team: p, opponent: 1 - p, settled };
}

// A side's chance as shown on the bar, to one decimal place. Until the matchup is settled it never
// reads 100.0% or 0.0%, however lopsided: ">99.9%" and "<0.1%" instead.
export function formatChance(probability: number, settled: boolean): string {
  if (!settled && probability > 0.999) return '>99.9%';
  if (!settled && probability < 0.001) return '<0.1%';
  return `${roundPercent(probability).toFixed(1)}%`;
}

// A chance as a percentage to the tenth, rounded so the two sides always add up to 100 (59.95/40.05
// reads 60.0/40.0, not 60.0/40.1). Rounded in whole tenths; the small nudge stops float error like
// 0.5955 * 1000 = 595.4999... rounding down.
export function roundPercent(probability: number): number {
  const favouriteTenths = Math.round(Math.max(probability, 1 - probability) * 1000 + 1e-9);
  return (probability >= 0.5 ? favouriteTenths : 1000 - favouriteTenths) / 10;
}

// A side's share of the bar's width, kept to a visible sliver on each side until settled.
export function barShare(probability: number, settled: boolean): number {
  return settled ? probability : Math.min(0.99, Math.max(0.01, probability));
}

export function barTone(probability: number): BarTone {
  const percent = roundPercent(probability);
  if (percent >= WINNING_AT_PERCENT) return 'winning';
  if (percent <= LOSING_AT_PERCENT) return 'losing';
  return 'neutral';
}

// Standard normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation (error < 1.5e-7).
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
