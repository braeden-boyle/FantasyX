import { describe, expect, it } from 'vitest';
import { MatchupTeam, Player } from '../models/team.model';
import {
  GAME_LENGTH_MS,
  POSITION_DEFAULT_SPREAD,
  barShare,
  barTone,
  espnProjection,
  formatChance,
  roundPercent,
  normalCdf,
  playerSpread,
  remainingFraction,
  winProbability,
} from './win-probability';

const KICKOFF = new Date('2026-10-04T17:00:00Z');
const BEFORE_KICKOFF = new Date(KICKOFF.getTime() - 60 * 60 * 1000);

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
    gameTimeUtc: KICKOFF.toISOString(),
    opponentPositionRank: null,
    gameFinal: false,
    statLine: null,
    gameState: null,
    gameDetail: null,
    possessionTeam: null,
    redZone: false,
    ...overrides,
  };
}

function side(teamId: number, points: number, players: Player[]): MatchupTeam {
  return {
    team: {
      teamId,
      name: `Team ${teamId}`,
      abbrev: `T${teamId}`,
      leagueName: 'League',
      wins: 0,
      losses: 0,
      ties: 0,
      standingRank: 0,
      leagueSize: 2,
      players,
    },
    logoUrl: null,
    points,
    projectedPoints: null,
  };
}

describe('normalCdf', () => {
  it('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413, 4);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('remainingFraction', () => {
  it('is 1 before kickoff and at kickoff', () => {
    expect(remainingFraction(player(), BEFORE_KICKOFF)).toBe(1);
    expect(remainingFraction(player(), KICKOFF)).toBe(1);
  });

  it('is about half at the midpoint of a game', () => {
    const halfway = new Date(KICKOFF.getTime() + GAME_LENGTH_MS / 2);
    expect(remainingFraction(player(), halfway)).toBeCloseTo(0.5, 6);
  });

  it('is 0 after the game length even before stats are official', () => {
    const later = new Date(KICKOFF.getTime() + GAME_LENGTH_MS + 60_000);
    expect(remainingFraction(player(), later)).toBe(0);
  });

  it('is 0 once final or with no game this week', () => {
    expect(remainingFraction(player({ gameFinal: true }), BEFORE_KICKOFF)).toBe(0);
    expect(remainingFraction(player({ opponent: null, gameTimeUtc: null }), BEFORE_KICKOFF)).toBe(0);
  });
});

describe('playerSpread', () => {
  it('is the position default with no history', () => {
    expect(playerSpread('QB')).toBe(POSITION_DEFAULT_SPREAD['QB']);
    expect(playerSpread('K', [])).toBe(POSITION_DEFAULT_SPREAD['K']);
  });

  it('moves toward the player history as games accumulate', () => {
    const history = (games: number) => Array.from({ length: games }, (_, i) => (i % 2 ? 12 : -12));
    const few = playerSpread('WR', history(1));
    const many = playerSpread('WR', history(40));
    expect(few).toBeGreaterThan(POSITION_DEFAULT_SPREAD['WR']);
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThan(12);
  });
});

describe('winProbability', () => {
  it('is 100/0 when every game is final', () => {
    const done = [player({ gameFinal: true })];
    const result = winProbability(side(1, 110, done), side(2, 90, done), espnProjection, null, BEFORE_KICKOFF);
    expect(result).toEqual({ team: 1, opponent: 0, settled: true });
  });

  it('is 50/50 on a finished tie', () => {
    const done = [player({ gameFinal: true })];
    const result = winProbability(side(1, 95, done), side(2, 95, done), espnProjection, null, BEFORE_KICKOFF);
    expect(result).toEqual({ team: 0.5, opponent: 0.5, settled: true });
  });

  it('is 50/50 for identical teams before kickoff', () => {
    const lineup = [player(), player({ playerId: 2, position: 'RB' })];
    const result = winProbability(side(1, 0, lineup), side(2, 0, lineup), espnProjection, null, BEFORE_KICKOFF);
    expect(result.team).toBeCloseTo(0.5, 6);
  });

  it('favours the side projected to score more', () => {
    const result = winProbability(
      side(1, 0, [player({ projectedPoints: 25 })]),
      side(2, 0, [player({ projectedPoints: 10 })]),
      espnProjection,
      null,
      BEFORE_KICKOFF,
    );
    expect(result.team).toBeGreaterThan(0.5);
    expect(result.team + result.opponent).toBeCloseTo(1, 10);
  });

  it('is near-certain for a big lead with only a kicker left', () => {
    const result = winProbability(
      side(1, 120, [player({ gameFinal: true })]),
      side(2, 80, [player({ position: 'K', projectedPoints: 8 })]),
      espnProjection,
      null,
      BEFORE_KICKOFF,
    );
    expect(result.team).toBeGreaterThan(0.99);
  });

  it('ignores bench players and players on a bye', () => {
    const base = [player()];
    const withExtras = [
      ...base,
      player({ playerId: 2, starter: false, projectedPoints: 40 }),
      player({ playerId: 3, opponent: null, gameTimeUtc: null, projectedPoints: 40 }),
    ];
    const a = winProbability(side(1, 0, base), side(2, 0, base), espnProjection, null, BEFORE_KICKOFF);
    const b = winProbability(side(1, 0, withExtras), side(2, 0, base), espnProjection, null, BEFORE_KICKOFF);
    expect(b.team).toBeCloseTo(a.team, 10);
  });

  it('adds no uncertainty for a starter ruled out (projected at 0)', () => {
    const lineup = [player({ gameFinal: true })];
    const ruledOut = [player({ gameFinal: true }), player({ playerId: 2, projectedPoints: 0 })];
    const result = winProbability(side(1, 90, lineup), side(2, 80, ruledOut), espnProjection, null, BEFORE_KICKOFF);
    // Certain, but not settled: the ruled-out starter's game hasn't been played.
    expect(result).toEqual({ team: 1, opponent: 0, settled: false });
  });

  it('uses a player spread when one is given', () => {
    const lineup = [player({ projectedPoints: 20 })];
    const opp = [player({ projectedPoints: 10 })];
    const wild = new Map([[1, Array.from({ length: 40 }, (_, i) => (i % 2 ? 30 : -30))]]);
    const steady = winProbability(side(1, 0, lineup), side(2, 0, opp), espnProjection, null, BEFORE_KICKOFF);
    const swingy = winProbability(side(1, 0, lineup), side(2, 0, opp), espnProjection, (id) => wild.get(id), BEFORE_KICKOFF);
    expect(swingy.team).toBeLessThan(steady.team);
  });
});

describe('barTone', () => {
  it('is neutral between 40% and 60%', () => {
    expect(barTone(0.5)).toBe('neutral');
    expect(barTone(0.599)).toBe('neutral');
    expect(barTone(0.401)).toBe('neutral');
    // Reads as 59.9% / 40.1% on the bar, so stays neutral too.
    expect(barTone(0.5994)).toBe('neutral');
    expect(barTone(1 - 0.5994)).toBe('neutral');
  });

  it('is green from 60% up and red from 40% down', () => {
    expect(barTone(0.6)).toBe('winning');
    expect(barTone(0.4)).toBe('losing');
    // Reads as 60.0% / 40.0% on the bar.
    expect(barTone(0.5995)).toBe('winning');
    expect(barTone(1 - 0.5995)).toBe('losing');
    expect(barTone(0.75)).toBe('winning');
    expect(barTone(0.25)).toBe('losing');
  });
});

describe('formatChance and barShare', () => {
  it('never shows 100% or 0% before the matchup is settled', () => {
    expect(formatChance(1, false)).toBe('>99.9%');
    expect(formatChance(0.9996, false)).toBe('>99.9%');
    expect(formatChance(0, false)).toBe('<0.1%');
    expect(formatChance(0.0004, false)).toBe('<0.1%');
    expect(barShare(1, false)).toBe(0.99);
    expect(barShare(0, false)).toBe(0.01);
  });

  it('shows percentages to the tenth in between', () => {
    expect(formatChance(0.999, false)).toBe('99.9%');
    expect(formatChance(0.995, false)).toBe('99.5%');
    expect(formatChance(0.68449, false)).toBe('68.4%');
    expect(formatChance(0.5, false)).toBe('50.0%');
    expect(formatChance(0.001, false)).toBe('0.1%');
    expect(barShare(0.684, false)).toBe(0.684);
  });

  it('shows 100% and 0% once settled', () => {
    expect(formatChance(1, true)).toBe('100.0%');
    expect(formatChance(0, true)).toBe('0.0%');
    expect(barShare(0, true)).toBe(0);
  });

  it('is not settled while any starter on either side has a game left', () => {
    const done = [player({ gameFinal: true })];
    const lead = winProbability(
      side(1, 150, done),
      side(2, 40, [player({ gameFinal: true }), player({ playerId: 2, position: 'K', projectedPoints: 8 })]),
      espnProjection,
      null,
      BEFORE_KICKOFF,
    );
    expect(lead.settled).toBe(false);
    expect(formatChance(lead.team, lead.settled)).toBe('>99.9%');
    // Bench players and players with no game this week don't hold it open.
    const withBench = [player({ gameFinal: true }), player({ playerId: 3, starter: false })];
    expect(winProbability(side(1, 90, withBench), side(2, 80, done), espnProjection, null, BEFORE_KICKOFF).settled).toBe(true);
  });
});

describe('roundPercent', () => {
  it('keeps the two sides adding up to 100', () => {
    expect(roundPercent(0.5955)).toBe(59.6);
    expect(roundPercent(1 - 0.5955)).toBe(40.4);
    expect(roundPercent(0.59949)).toBe(59.9);
    expect(roundPercent(0.5)).toBe(50);
    for (let p = 0; p <= 1; p += 0.00005) {
      expect(Math.round((roundPercent(p) + roundPercent(1 - p)) * 10)).toBe(1000);
    }
  });
});

describe('projection source', () => {
  it('uses the projection it is given for expected points', () => {
    const lineup = [player({ projectedPoints: 10 })];
    const boosted = (p: Player) => p.projectedPoints + 15;
    const espn = winProbability(side(1, 0, lineup), side(2, 0, lineup), espnProjection, null, BEFORE_KICKOFF);
    const mine = winProbability(
      side(1, 0, lineup),
      side(2, 0, [player({ playerId: 2, projectedPoints: 10 })]),
      (p) => (p.playerId === 1 ? boosted(p) : p.projectedPoints),
      null,
      BEFORE_KICKOFF,
    );
    expect(espn.team).toBeCloseTo(0.5, 6);
    expect(mine.team).toBeGreaterThan(0.5);
  });
});
