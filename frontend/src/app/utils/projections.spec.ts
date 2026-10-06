import { describe, expect, it } from 'vitest';
import { HistoryWeek } from '../models/team.model';
import {
  BIAS_SHRINKAGE_GAMES,
  backtest,
  buildModel,
  customProjection,
  playerBias,
  rankOffset,
  residuals,
  upcomingProjection,
} from './projections';

// Deterministic noise, so the backtests below are stable.
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function week(w: number, actual: number, projected: number, rank: number | null = null): HistoryWeek {
  return { week: w, actual, projected, opponentPositionRank: rank };
}

// players x weeks of history where each player's actual = projected + offset(player, week) + noise.
function league(
  players: number,
  weeks: number,
  offset: (player: number, week: number, rank: number) => number,
  noise: number,
  seed = 1,
): { histories: Map<number, HistoryWeek[]>; positions: Map<number, string> } {
  const next = random(seed);
  const histories = new Map<number, HistoryWeek[]>();
  const positions = new Map<number, string>();
  for (let p = 1; p <= players; p++) {
    positions.set(p, 'WR');
    histories.set(
      p,
      Array.from({ length: weeks }, (_, i) => {
        const w = i + 1;
        const rank = 1 + Math.floor(next() * 32);
        const projected = 8 + next() * 10;
        return week(w, projected + offset(p, w, rank) + (next() * 2 - 1) * noise, projected, rank);
      }),
    );
  }
  return { histories, positions };
}

describe('playerBias', () => {
  it('is 0 with no history', () => {
    expect(playerBias([])).toBe(0);
  });

  it('stays small with only a few games', () => {
    const one = playerBias([week(1, 20, 10)]);
    const three = playerBias([week(1, 20, 10), week(2, 20, 10), week(3, 20, 10)]);
    expect(one).toBeCloseTo(10 / (1 + BIAS_SHRINKAGE_GAMES), 10);
    expect(one).toBeLessThan(2);
    expect(three).toBeGreaterThan(one);
    expect(three).toBeLessThan(10);
  });

  it('only reads weeks before the one asked about', () => {
    const weeks = [week(1, 20, 10), week(2, 0, 10), week(3, 50, 10)];
    expect(playerBias(weeks, 2)).toBe(playerBias([week(1, 20, 10)]));
    expect(playerBias(weeks, 1)).toBe(0);
  });
});

describe('customProjection', () => {
  it('keeps a player ESPN projects at 0 at 0', () => {
    expect(customProjection(0, 5, 2, 32)).toBe(0);
  });

  it('never goes below 0', () => {
    expect(customProjection(3, -10, 0, null)).toBe(0);
  });

  it('adds the bias and the rank term', () => {
    expect(customProjection(10, 2, 0, null)).toBe(12);
    expect(customProjection(10, 0, 3, 32)).toBeCloseTo(13, 10);
    expect(customProjection(10, 0, 3, 1)).toBeCloseTo(7, 10);
    expect(rankOffset(null)).toBeNull();
  });
});

describe('buildModel', () => {
  it('equals ESPN in week 1', () => {
    const { histories, positions } = league(5, 6, () => 5, 1);
    const model = buildModel(histories, positions, true);
    expect(model.project(1, 'WR', 1, 12, 16)).toBe(12);
  });

  it('never uses the week being projected or later', () => {
    const weeks = [week(1, 10, 10), week(2, 10, 10), week(3, 60, 10)];
    const model = buildModel(new Map([[1, weeks]]), new Map([[1, 'WR']]), false);
    expect(model.project(1, 'WR', 3, 10, null)).toBe(10);
    expect(model.project(1, 'WR', 4, 10, null)).toBeGreaterThan(10);
  });

  it('recovers a rank effect shared by a position', () => {
    const { histories, positions } = league(40, 12, (_, __, rank) => 4 * rankOffset(rank)!, 1);
    const model = buildModel(histories, positions, true);
    // Toughest vs easiest opponent next week, for a player with no bias.
    const tough = model.project(999, 'WR', 13, 10, 1);
    const easy = model.project(999, 'WR', 13, 10, 32);
    expect(easy - tough).toBeGreaterThan(6);
    expect(easy - tough).toBeLessThan(8.5);
    // No slope for a position with no history.
    expect(model.project(999, 'QB', 13, 10, 32)).toBe(10);
  });
});

describe('residuals', () => {
  it('is actual minus projection', () => {
    const weeks = [week(1, 12, 10), week(2, 7, 10)];
    expect(residuals(1, 'WR', weeks, null)).toEqual([2, -3]);
  });
});

describe('backtest', () => {
  it('beats ESPN when players have a steady bias', () => {
    // A full regular season: shrinkage keeps the bias small early on, so the gain builds with weeks.
    const { histories, positions } = league(30, 17, (p) => (p % 2 ? 6 : -6), 3);
    const result = backtest(histories, positions);
    expect(result.playerWeeks).toBe(510);
    expect(result.bias.mae).toBeLessThan(result.espn.mae * 0.9);
    expect(result.bias.rmse).toBeLessThan(result.espn.rmse * 0.9);
  });

  it('gains nothing on pure noise', () => {
    const { histories, positions } = league(30, 10, () => 0, 8, 7);
    const result = backtest(histories, positions);
    expect(result.bias.mae).toBeGreaterThan(result.espn.mae * 0.97);
    expect(result.bias.mae).toBeLessThan(result.espn.mae * 1.08);
  });

  it('is empty with no history', () => {
    expect(backtest(new Map(), new Map())).toEqual({
      espn: { mae: 0, rmse: 0 },
      bias: { mae: 0, rmse: 0 },
      biasRank: { mae: 0, rmse: 0 },
      playerWeeks: 0,
    });
  });
});

describe('upcomingProjection', () => {
  const history = [week(1, 30, 10), week(2, 30, 10)];

  it('is ESPN’s as it is in ESPN mode', () => {
    expect(upcomingProjection('espn', 12, history, 5)).toBe(12);
  });

  it('adds the player’s own bias in FantasyX mode, from weeks before the one projected', () => {
    expect(upcomingProjection('fantasyx', 12, history, 5)).toBeCloseTo(12 + playerBias(history, 5));
    expect(upcomingProjection('fantasyx', 12, history, 2)).toBeCloseTo(12 + playerBias(history, 2));
  });

  it('keeps a week ESPN doesn’t project at 0', () => {
    expect(upcomingProjection('fantasyx', 0, history, 5)).toBe(0);
  });
});
