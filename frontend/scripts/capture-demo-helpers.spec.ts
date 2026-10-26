import { describe, expect, it } from 'vitest';
import { NflGame } from '../src/app/models/team.model';
import { firstKickoff, frameGameIds, gameDayIds, gameDayOver, parseScenario } from './capture-demo-helpers';

function game(eventId: string, kickoffUtc: string | null, state: NflGame['state'] = 'pre'): NflGame {
  const team = { proTeamId: 0, abbrev: '', name: '', score: null, record: null, linescores: [] };
  return {
    eventId,
    kickoffUtc,
    state,
    detail: null,
    statusText: '',
    away: team,
    home: team,
    possessionTeam: null,
    redZone: false,
    downDistance: null,
    lastPlay: null,
    broadcast: null,
  };
}

// A week as seen on Sunday morning: Thursday's game final, three Sunday games (1:00, 4:25 and the
// night game, in UTC) and Monday night still to come.
const week = [
  game('thu', '2026-10-30T00:15:00Z', 'post'),
  game('sun-late', '2026-11-01T21:25:00Z'),
  game('sun-early', '2026-11-01T18:00:00Z'),
  game('sun-night', '2026-11-02T01:20:00Z'),
  game('mon', '2026-11-03T01:15:00Z'),
];

describe('parseScenario', () => {
  it('takes the two scenarios and nothing else', () => {
    expect(parseScenario('midweek')).toBe('midweek');
    expect(parseScenario('gameday')).toBe('gameday');
    expect(() => parseScenario(undefined)).toThrow('midweek or gameday');
    expect(() => parseScenario('sunday')).toThrow();
  });
});

describe('gameDayIds', () => {
  it('is the day of the first game not yet final, in kickoff order, without Monday night', () => {
    expect(gameDayIds(week)).toEqual(['sun-early', 'sun-late', 'sun-night']);
  });

  it('includes games already under way', () => {
    const underway = week.map((g) => (g.eventId === 'sun-early' ? { ...g, state: 'in' as const } : g));
    expect(gameDayIds(underway)).toEqual(['sun-early', 'sun-late', 'sun-night']);
  });

  it('is empty once every game is final, and skips games without a kickoff', () => {
    expect(gameDayIds(week.map((g) => ({ ...g, state: 'post' as const })))).toEqual([]);
    expect(gameDayIds([game('tbd', null)])).toEqual([]);
  });
});

describe('firstKickoff', () => {
  it('is the earliest kickoff among the day’s games', () => {
    expect(firstKickoff(week, ['sun-late', 'sun-early'])?.toISOString()).toBe('2026-11-01T18:00:00.000Z');
    expect(firstKickoff(week, [])).toBeNull();
  });
});

describe('frameGameIds', () => {
  it('takes live games, and final games only the first time they’re seen final', () => {
    const now = [game('a', null, 'in'), game('b', null, 'post'), game('c', null, 'post'), game('d', null, 'pre')];
    const previous = new Map<string, NflGame['state']>([
      ['a', 'in'],
      ['b', 'in'],
      ['c', 'post'],
    ]);
    expect(frameGameIds(now, previous)).toEqual(['a', 'b']);
  });

  it('takes a game first seen final', () => {
    expect(frameGameIds([game('a', null, 'post')], new Map())).toEqual(['a']);
  });
});

describe('gameDayOver', () => {
  const dayIds = ['sun-early', 'sun-late', 'sun-night'];
  const at = (iso: string) => new Date(iso);

  it('waits for every one of the day’s games to be final', () => {
    const partway = week.map((g) => (g.eventId === 'sun-night' ? g : { ...g, state: 'post' as const }));
    expect(gameDayOver(partway, dayIds, at('2026-11-02T01:00:00Z'))).toBe(false);
    const done = week.map((g) => (g.eventId === 'mon' ? g : { ...g, state: 'post' as const }));
    expect(gameDayOver(done, dayIds, at('2026-11-02T04:30:00Z'))).toBe(true);
  });

  it('stops waiting for a game that never starts', () => {
    const stalled = week.map((g) => (g.eventId === 'sun-night' || g.eventId === 'mon' ? g : { ...g, state: 'post' as const }));
    expect(gameDayOver(stalled, dayIds, at('2026-11-02T07:00:00Z'))).toBe(false);
    expect(gameDayOver(stalled, dayIds, at('2026-11-02T07:21:00Z'))).toBe(true);
  });

  it('counts a game missing from the scoreboard as done', () => {
    expect(gameDayOver([], dayIds, at('2026-11-01T12:00:00Z'))).toBe(true);
  });
});
