import { describe, expect, it } from 'vitest';
import { Player, ScheduledMatchup } from '../models/team.model';
import {
  RESULTS_WEIGHT_GAMES,
  bestLineupTotal,
  completedScores,
  powerRankings,
  powerScores,
  rankByStrength,
  remainingScheduleStrength,
  rosterStrength,
  teamStrength,
} from './power-rankings';

function player(overrides: Partial<Player> = {}): Player {
  return {
    playerId: 1,
    fullName: 'Test Player',
    position: 'WR',
    proTeam: 'KC',
    slot: 'WR',
    starter: true,
    injuryStatus: null,
    headshotUrl: '',
    isTeamLogo: false,
    projectedPoints: 10,
    points: 0,
    opponent: 'BUF',
    opponentIsHome: true,
    gameTimeUtc: null,
    opponentPositionRank: null,
    gameFinal: false,
    ...overrides,
  };
}

const espn = (p: Player) => p.projectedPoints;

function game(matchupPeriod: number, homeTeamId: number, homePoints: number, awayTeamId: number | null, awayPoints: number | null): ScheduledMatchup {
  return { matchupPeriod, homeTeamId, awayTeamId, homePoints, awayPoints, winner: 'UNDECIDED' };
}

describe('rosterStrength', () => {
  it('sums the starters', () => {
    const players = [player({ playerId: 1, projectedPoints: 20 }), player({ playerId: 2, projectedPoints: 15 })];
    expect(rosterStrength(players, espn)).toBe(35);
  });

  it('swaps a starter projected at 0 for the best bench player at that position', () => {
    const players = [
      player({ playerId: 1, position: 'RB', projectedPoints: 0 }),
      player({ playerId: 2, position: 'RB', starter: false, slot: 'BE', projectedPoints: 8 }),
      player({ playerId: 3, position: 'RB', starter: false, slot: 'BE', projectedPoints: 12 }),
      player({ playerId: 4, position: 'WR', starter: false, slot: 'BE', projectedPoints: 30 }),
    ];
    expect(rosterStrength(players, espn)).toBe(12);
  });

  it('uses each bench player once and never one on IR', () => {
    const players = [
      player({ playerId: 1, position: 'WR', projectedPoints: 0 }),
      player({ playerId: 2, position: 'WR', projectedPoints: 0 }),
      player({ playerId: 3, position: 'WR', starter: false, slot: 'BE', projectedPoints: 9 }),
      player({ playerId: 4, position: 'WR', starter: false, slot: 'IR', projectedPoints: 25 }),
    ];
    expect(rosterStrength(players, espn)).toBe(9);
  });
});

describe('completedScores', () => {
  it('collects each team’s scores before the period, skipping byes', () => {
    const schedule = [game(1, 1, 100, 2, 90), game(1, 3, 80, null, null), game(2, 1, 110, 3, 70), game(3, 1, 999, 2, 999)];
    const scores = completedScores(schedule, 3);
    expect(scores.get(1)).toEqual([100, 110]);
    expect(scores.get(2)).toEqual([90]);
    expect(scores.get(3)).toEqual([70]);
  });
});

describe('teamStrength', () => {
  it('is the roster alone before any results', () => {
    expect(teamStrength([], 120)).toMatchObject({ strength: 120, resultsWeight: 0 });
  });

  it('weighs results by n / (n + k)', () => {
    const scores = Array.from({ length: RESULTS_WEIGHT_GAMES }, () => 100);
    expect(teamStrength(scores, 140)).toMatchObject({ strength: 120, resultsWeight: 0.5 });
  });

  it('falls back to results alone without a roster, and null with neither', () => {
    expect(teamStrength([90, 110], null)).toMatchObject({ strength: 100, resultsWeight: 1 });
    expect(teamStrength([], null)).toBeNull();
  });
});

describe('powerRankings', () => {
  it('ranks by strength, breaking ties by team id', () => {
    const ranks = rankByStrength(new Map([[3, 100], [1, 120], [2, 100]]));
    expect([...ranks.entries()]).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it('reports places climbed since the previous ranking', () => {
    const now = new Map([[1, 130], [2, 120], [3, 110]]);
    const before = new Map([[1, 100], [2, 120], [3, 110]]);
    expect(powerRankings(now, before).map((r) => [r.teamId, r.rank, r.movement])).toEqual([
      [1, 1, 2],
      [2, 2, -1],
      [3, 3, -1],
    ]);
  });

  it('scores the top team 100 and the rest as a share of its strength', () => {
    const ranked = powerRankings(new Map([[1, 120], [2, 90], [3, 60]]), null);
    expect(ranked.map((r) => r.score)).toEqual([100, 75, 50]);
    expect([...powerScores(new Map([[1, 0], [2, -5]])).values()]).toEqual([0, 0]);
  });

  it('has no movement without a previous ranking', () => {
    expect(powerRankings(new Map([[1, 100]]), null)[0].movement).toBeNull();
  });
});

describe('remainingScheduleStrength', () => {
  it('averages each team’s remaining opponents, each in the week they meet', () => {
    const schedule = [game(1, 1, 100, 2, 90), game(2, 1, 0, 3, 0), game(3, 1, 0, 2, 0), game(3, 3, 0, 4, 0)];
    // Team 3 is 120 in week 2 and 80 otherwise; team 2 is 100 throughout.
    const strengthIn = (teamId: number, period: number) => (teamId === 3 ? (period === 2 ? 120 : 80) : 100);
    const schedules = remainingScheduleStrength(schedule, 2, strengthIn);
    expect(schedules.get(1)).toBe(110); // 3 in week 2 (120), then 2 (100); week 1 is already played
    expect(schedules.get(2)).toBe(100);
    expect(schedules.get(3)).toBe(100); // 1 in week 2 and 4 in week 3, both 100
    expect(schedules.get(4)).toBe(80); // 3 in week 3
  });
});

describe('bestLineupTotal', () => {
  const slots = [
    { slot: 'QB', count: 1, eligiblePositions: ['QB'] },
    { slot: 'RB', count: 1, eligiblePositions: ['RB'] },
    { slot: 'WR', count: 1, eligiblePositions: ['WR'] },
    { slot: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ];
  const pick = (playerId: number, position: string, projected: number) => ({ playerId, position, projected });

  it('fills dedicated slots first and the flex with the best player left', () => {
    const players = [pick(1, 'QB', 20), pick(2, 'RB', 15), pick(3, 'RB', 12), pick(4, 'WR', 14), pick(5, 'TE', 9), pick(6, 'QB', 18)];
    // QB 20, RB 15, WR 14, FLEX takes RB 12 over TE 9; the backup QB can't flex.
    expect(bestLineupTotal(players, slots)).toBe(61);
  });

  it('leaves a slot empty when nobody can fill it', () => {
    expect(bestLineupTotal([pick(1, 'QB', 20), pick(2, 'K', 8)], slots)).toBe(20);
  });
});
