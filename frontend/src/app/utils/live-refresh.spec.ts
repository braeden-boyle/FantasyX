import { describe, expect, it } from 'vitest';
import { Player } from '../models/team.model';
import { FALLBACK_FINAL_AFTER_MS, fieldState, gamePhase } from './player-format';
import { REFRESH_INTERVAL_MS, formatPhaseCounts, nextRefreshDelay, phaseCounts } from './live-refresh';

const KICKOFF = new Date('2026-10-04T17:00:00Z');
const MINUTE = 60 * 1000;
const at = (offsetMs: number) => new Date(KICKOFF.getTime() + offsetMs);

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

const bye = () => player({ opponent: null, gameTimeUtc: null });

describe('gamePhase', () => {
  it('is none without a game', () => {
    expect(gamePhase(bye(), KICKOFF)).toBe('none');
  });

  it("follows ESPN's scoreboard when it has the game", () => {
    // The scoreboard wins over the clock: a delayed game is still upcoming after its kickoff time.
    expect(gamePhase(player({ gameState: 'pre' }), at(10 * MINUTE))).toBe('upcoming');
    expect(gamePhase(player({ gameState: 'in' }), at(-MINUTE))).toBe('live');
    expect(gamePhase(player({ gameState: 'post' }), at(MINUTE))).toBe('final');
  });

  it('is final once stats are official, whatever the scoreboard says', () => {
    expect(gamePhase(player({ gameFinal: true, gameState: 'in' }), KICKOFF)).toBe('final');
  });

  it('falls back to the kickoff time without the scoreboard', () => {
    expect(gamePhase(player(), at(-MINUTE))).toBe('upcoming');
    expect(gamePhase(player(), KICKOFF)).toBe('live');
    expect(gamePhase(player(), at(FALLBACK_FINAL_AFTER_MS - 1))).toBe('live');
    expect(gamePhase(player(), at(FALLBACK_FINAL_AFTER_MS))).toBe('final');
  });
});

describe('fieldState', () => {
  const live = (overrides: Partial<Player> = {}) => player({ gameState: 'in', ...overrides });

  it('marks offense, kickers included, when their team has the ball', () => {
    expect(fieldState(live({ possessionTeam: 'KC' }), KICKOFF)).toBe('ball');
    expect(fieldState(live({ position: 'K', possessionTeam: 'KC' }), KICKOFF)).toBe('ball');
    expect(fieldState(live({ possessionTeam: 'BUF' }), KICKOFF)).toBe('none');
  });

  it('marks a D/ST when the opponent has the ball', () => {
    const defense = (possessionTeam: string) => live({ position: 'D/ST', possessionTeam });
    expect(fieldState(defense('BUF'), KICKOFF)).toBe('ball');
    expect(fieldState(defense('KC'), KICKOFF)).toBe('none');
  });

  it('becomes the red-zone variant inside the 20', () => {
    expect(fieldState(live({ possessionTeam: 'KC', redZone: true }), KICKOFF)).toBe('redZone');
    expect(fieldState(live({ position: 'D/ST', possessionTeam: 'BUF', redZone: true }), KICKOFF)).toBe('redZone');
  });

  it('is none when ESPN does not say who has the ball, or the game is not live', () => {
    expect(fieldState(live(), KICKOFF)).toBe('none');
    expect(fieldState(player({ gameState: 'post', possessionTeam: 'KC' }), KICKOFF)).toBe('none');
    expect(fieldState(player({ gameState: 'pre', possessionTeam: 'KC' }), KICKOFF)).toBe('none');
  });
});

describe('nextRefreshDelay', () => {
  it('refreshes a minute after the fetch while a game is live', () => {
    const fetchedAt = at(30 * MINUTE);
    const players = [player({ gameState: 'in' }), player({ gameState: 'pre', gameTimeUtc: at(3 * 60 * MINUTE).toISOString() })];
    expect(nextRefreshDelay(players, fetchedAt, fetchedAt)).toBe(REFRESH_INTERVAL_MS);
    expect(nextRefreshDelay(players, fetchedAt, at(30 * MINUTE + 20 * 1000))).toBe(40 * 1000);
  });

  it('is due at once when the data is older than the interval', () => {
    const fetchedAt = at(30 * MINUTE);
    expect(nextRefreshDelay([player({ gameState: 'in' })], fetchedAt, at(45 * MINUTE))).toBe(0);
  });

  it('waits until a minute after the next kickoff when nothing is live', () => {
    const fetchedAt = at(-2 * 60 * MINUTE);
    const players = [player({ gameState: 'pre' }), player({ gameState: 'pre', gameTimeUtc: at(60 * MINUTE).toISOString() })];
    expect(nextRefreshDelay(players, fetchedAt, fetchedAt)).toBe(2 * 60 * MINUTE + MINUTE);
  });

  it('checks a delayed game once a minute, not in a tight loop', () => {
    const fetchedAt = at(10 * MINUTE);
    expect(nextRefreshDelay([player({ gameState: 'pre' })], fetchedAt, fetchedAt)).toBe(REFRESH_INTERVAL_MS);
  });

  it('is null once every game is over or there is none', () => {
    expect(nextRefreshDelay([player({ gameState: 'post' }), bye()], KICKOFF, KICKOFF)).toBeNull();
    expect(nextRefreshDelay([], KICKOFF, KICKOFF)).toBeNull();
  });
});

describe('phaseCounts', () => {
  it('counts byes as done', () => {
    const players = [
      player({ gameState: 'pre' }),
      player({ gameState: 'pre' }),
      player({ gameState: 'in' }),
      player({ gameState: 'post' }),
      bye(),
    ];
    expect(phaseCounts(players, KICKOFF)).toEqual({ toPlay: 2, live: 1, done: 2 });
  });
});

describe('formatPhaseCounts', () => {
  it('leaves out empty groups', () => {
    expect(formatPhaseCounts({ toPlay: 4, live: 2, done: 3 })).toBe('4 to play · 2 live · 3 done');
    expect(formatPhaseCounts({ toPlay: 0, live: 0, done: 9 })).toBe('9 done');
  });
});
