import { describe, expect, it } from 'vitest';
import { NflGame, NflGameTeam, Player } from '../models/team.model';
import { FALLBACK_FINAL_AFTER_MS } from './player-format';
import {
  nflGamePhase,
  periodName,
  periodShort,
  playersInGame,
  stripFocusIndex,
  teamFieldState,
  winner,
} from './nfl-games';
import { GAME_REFRESH_INTERVAL_MS, REFRESH_INTERVAL_MS, nextRefreshDelay } from './live-refresh';

const KICKOFF = new Date('2026-10-18T17:00:00Z');
const MINUTE = 60 * 1000;
const at = (offsetMs: number) => new Date(KICKOFF.getTime() + offsetMs);

function team(abbrev: string, score: number | null = null): NflGameTeam {
  return { proTeamId: 1, abbrev, name: abbrev, score, record: null, linescores: [] };
}

function game(overrides: Partial<NflGame> = {}): NflGame {
  return {
    eventId: '1',
    kickoffUtc: KICKOFF.toISOString(),
    state: 'pre',
    detail: null,
    statusText: '',
    away: team('BUF'),
    home: team('KC'),
    possessionTeam: null,
    redZone: false,
    downDistance: null,
    lastPlay: null,
    broadcast: null,
    ...overrides,
  };
}

function player(proTeam: string, position = 'WR'): Player {
  return {
    playerId: 1,
    fullName: 'Test Player',
    position,
    proTeam,
    slot: position,
    starter: true,
    injuryStatus: null,
    headshotUrl: '',
    isTeamLogo: position === 'D/ST',
    projectedPoints: 10,
    points: 0,
    opponent: null,
    opponentIsHome: null,
    gameTimeUtc: null,
    opponentPositionRank: null,
    gameFinal: false,
    statLine: null,
    gameState: null,
    gameDetail: null,
    possessionTeam: null,
    redZone: false,
  };
}

describe('nflGamePhase', () => {
  it("follows ESPN's state, even against the clock", () => {
    expect(nflGamePhase(game({ state: 'pre' }), at(10 * MINUTE))).toBe('upcoming');
    expect(nflGamePhase(game({ state: 'in' }), at(-MINUTE))).toBe('live');
    expect(nflGamePhase(game({ state: 'post' }), at(MINUTE))).toBe('final');
  });

  it('falls back to the kickoff time for a state it does not know', () => {
    const unknown = game({ state: 'delayed' as NflGame['state'] });
    expect(nflGamePhase(unknown, at(-MINUTE))).toBe('upcoming');
    expect(nflGamePhase(unknown, at(MINUTE))).toBe('live');
    expect(nflGamePhase(unknown, at(FALLBACK_FINAL_AFTER_MS))).toBe('final');
  });
});

describe('teamFieldState', () => {
  const live = game({ state: 'in', possessionTeam: 'KC' });

  it('marks the team with the ball, and only while live', () => {
    expect(teamFieldState(live, live.home, KICKOFF)).toBe('ball');
    expect(teamFieldState(live, live.away, KICKOFF)).toBe('none');
    expect(teamFieldState({ ...live, state: 'post' }, live.home, KICKOFF)).toBe('none');
  });

  it('marks the red zone', () => {
    expect(teamFieldState({ ...live, redZone: true }, live.home, KICKOFF)).toBe('redZone');
  });

  it('marks no one when ESPN has no possession', () => {
    expect(teamFieldState({ ...live, possessionTeam: null }, live.home, KICKOFF)).toBe('none');
  });
});

describe('playersInGame', () => {
  it('counts players on either team, a D/ST included', () => {
    const roster = [player('BUF'), player('KC', 'D/ST'), player('DET'), player('KC', 'K')];
    expect(playersInGame(game(), roster)).toBe(3);
  });

  it('is 0 for a roster with no one in the game', () => {
    expect(playersInGame(game(), [player('DET')])).toBe(0);
  });
});

describe('stripFocusIndex', () => {
  const final = game({ eventId: 'a', state: 'post' });
  const live = game({ eventId: 'b', state: 'in' });
  const upcoming = game({ eventId: 'c', state: 'pre' });

  it('prefers the first live game', () => {
    expect(stripFocusIndex([final, upcoming, live], KICKOFF)).toBe(2);
  });

  it('then the next game to kick off', () => {
    expect(stripFocusIndex([final, upcoming], KICKOFF)).toBe(1);
  });

  it('then the last game, or -1 with none', () => {
    expect(stripFocusIndex([final, { ...final, eventId: 'd' }], KICKOFF)).toBe(1);
    expect(stripFocusIndex([], KICKOFF)).toBe(-1);
  });
});

describe('winner', () => {
  it('is the higher score once final, and nobody on a tie or before the end', () => {
    const done = game({ state: 'post', away: team('BUF', 24), home: team('KC', 17) });
    expect(winner(done, KICKOFF)?.abbrev).toBe('BUF');
    expect(winner({ ...done, home: team('KC', 24) }, KICKOFF)).toBeNull();
    expect(winner({ ...done, state: 'in' }, KICKOFF)).toBeNull();
  });
});

describe('period names', () => {
  it('names quarters and overtime', () => {
    expect(periodName(1)).toBe('1st Quarter');
    expect(periodName(4)).toBe('4th Quarter');
    expect(periodName(5)).toBe('Overtime');
    expect(periodName(null)).toBe('');
    expect(periodShort(3)).toBe('Q3');
    expect(periodShort(5)).toBe('OT');
  });
});

describe('nextRefreshDelay with NFL games', () => {
  it('keeps refreshing for a live game no starter plays in', () => {
    expect(nextRefreshDelay([], KICKOFF, KICKOFF, [game({ state: 'in' })])).toBe(REFRESH_INTERVAL_MS);
  });

  it('waits for the next kickoff, and stops once every game is over', () => {
    const fetchedAt = at(-60 * MINUTE);
    expect(nextRefreshDelay([], fetchedAt, fetchedAt, [game()])).toBe(61 * MINUTE);
    expect(nextRefreshDelay([], KICKOFF, KICKOFF, [game({ state: 'post' })])).toBeNull();
  });

  it("uses the game page's shorter interval when given", () => {
    expect(nextRefreshDelay([], KICKOFF, KICKOFF, [game({ state: 'in' })], GAME_REFRESH_INTERVAL_MS)).toBe(
      GAME_REFRESH_INTERVAL_MS,
    );
  });
});
