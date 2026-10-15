import { describe, expect, it } from 'vitest';
import { LineupSlot, NflGame, Player } from '../models/team.model';
import { rosterValue } from './lineup';
import {
  AvailableEntry,
  MAX_SUGGESTIONS,
  MIN_GAIN,
  RosterEntry,
  WaiverPlayer,
  droppable,
  forPosition,
  mightHelp,
  proTeamLocked,
  waiverAdvice,
  weakestStarters,
} from './waivers';

const slot = (name: string, count: number, eligiblePositions: string[]): LineupSlot => ({ slot: name, count, eligiblePositions });

// QB, RB, WR and a RB/WR flex: small enough to work out by hand.
const slots = [slot('QB', 1, ['QB']), slot('RB', 1, ['RB']), slot('WR', 1, ['WR']), slot('FLEX', 1, ['RB', 'WR'])];

// Projections by week, from a list ([20, 0] is 20 in week 1 and 0 in week 2).
const byWeek = (points: number[]): Record<number, number> => Object.fromEntries(points.map((p, i) => [i + 1, p]));

function rostered(playerId: number, position: string, points: number[], overrides: Partial<RosterEntry> = {}): RosterEntry {
  return { playerId, position, projections: byWeek(points), injuredReserve: false, droppable: true, ...overrides };
}

function available(playerId: number, position: string, points: number[], locked = false): AvailableEntry {
  return { playerId, position, projections: byWeek(points), locked };
}

const valueOf = (players: readonly WaiverPlayer[], weeks: number[]) =>
  rosterValue(players, slots, weeks, (p, w) => p.projections[w] ?? 0).total;

// A full roster of six for two weeks: a backup QB who never plays, and in week 2 the starting RB and
// WR on bye, so the backup RB and WR start and the flex is left empty.
const roster = [
  rostered(1, 'QB', [20, 20]),
  rostered(2, 'QB', [12, 12]),
  rostered(3, 'RB', [15, 0]),
  rostered(4, 'RB', [9, 9]),
  rostered(5, 'WR', [14, 0]),
  rostered(6, 'WR', [7, 7]),
];
const weeks = [1, 2];

describe('waiverAdvice', () => {
  it('values a pickup as roster value after minus before, with the best drop', () => {
    // Before: 20+15+14+9 = 58 in week 1, 20+9+7 = 36 in week 2. Adding an 11-point WR for the
    // backup QB: 60, then 20+9+11+7 = 47, so +13. For the starting WR, on bye in week 2: 20+15+11+9 =
    // 55, then 47, so +8. For the backup WR: 60, then 20+9+11 = 40, so +6.
    const advice = waiverAdvice({ roster, available: [available(10, 'WR', [11, 11])], slots, weeks, rosterSize: 6 });
    const [pickup] = advice.suggestions;
    expect(advice.before.total).toBe(94);
    expect(pickup.drop?.playerId).toBe(2);
    expect(pickup.gain).toBe(13);
    expect(pickup.gain).toBe(valueOf([...roster.filter((p) => p.playerId !== 2), pickup.player], weeks) - 94);
    expect(pickup.weekGain).toBe(2);
    expect(pickup.startsIn).toBe(2);
    expect(pickup.alternative).toEqual({ drop: roster[4], gain: 8 });
  });

  it('needs no drop with an open roster spot, and IR takes no spot', () => {
    const withIr = [...roster, rostered(7, 'RB', [0, 0], { injuredReserve: true })];
    const pickup = available(10, 'WR', [11, 11]);
    const open = waiverAdvice({ roster: withIr, available: [pickup], slots, weeks, rosterSize: 7 });
    expect(open.openSpot).toBe(true);
    expect(open.suggestions[0].drop).toBeNull();
    expect(open.suggestions[0].alternative).toBeNull();
    expect(open.suggestions[0].gain).toBe(13);

    const full = waiverAdvice({ roster: withIr, available: [pickup], slots, weeks, rosterSize: 6 });
    expect(full.openSpot).toBe(false);
    expect(full.suggestions[0].drop?.playerId).toBe(2);
  });

  it('reads an unknown roster size as full', () => {
    const advice = waiverAdvice({ roster, available: [available(10, 'WR', [11, 11])], slots, weeks, rosterSize: 0 });
    expect(advice.openSpot).toBe(false);
    expect(advice.suggestions[0].drop).not.toBeNull();
  });

  it('never drops a player who is not droppable, and skips a pickup with nobody to drop', () => {
    const guarded = roster.map((p) => (p.playerId === 2 ? { ...p, droppable: false } : p));
    const advice = waiverAdvice({ roster: guarded, available: [available(10, 'WR', [11, 11])], slots, weeks, rosterSize: 6 });
    expect(advice.suggestions[0].drop?.playerId).toBe(5);
    expect(advice.suggestions[0].gain).toBe(8);

    const locked = roster.map((p) => ({ ...p, droppable: false }));
    expect(waiverAdvice({ roster: locked, available: [available(10, 'WR', [11, 11])], slots, weeks, rosterSize: 6 }).suggestions).toEqual([]);
  });

  it('counts a locked pickup from next week only', () => {
    const advice = waiverAdvice({ roster, available: [available(10, 'WR', [11, 11], true)], slots, weeks, rosterSize: 6 });
    expect(advice.suggestions[0].weekGain).toBe(0);
    expect(advice.suggestions[0].gain).toBe(11);
    expect(advice.suggestions[0].startsIn).toBe(1);
  });

  it('leaves out gains under MIN_GAIN, and players already rostered', () => {
    // A quarter-point RB fills week 2's empty flex, for less than MIN_GAIN. Player 4 is on the roster.
    const tiny = available(11, 'RB', [0, MIN_GAIN / 2]);
    const advice = waiverAdvice({ roster, available: [tiny, available(4, 'RB', [30, 30])], slots, weeks, rosterSize: 7 });
    expect(advice.suggestions).toEqual([]);
  });

  it('sorts by rest-of-season gain, then this week, then player id', () => {
    const advice = waiverAdvice({
      roster,
      available: [
        available(20, 'WR', [11, 11]),
        available(21, 'RB', [10, 12]),
        available(22, 'WR', [12, 10]),
        available(23, 'WR', [20, 20]),
        available(24, 'WR', [11, 11]),
      ],
      slots,
      weeks,
      rosterSize: 7,
    });
    // With the open spot: 23 gains 11 + 20; the rest 13, split 3/10, 2/11 (20 and 24 alike) and 1/12.
    expect(advice.suggestions.map((s) => [s.player.playerId, s.gain, s.weekGain])).toEqual([
      [23, 31, 11],
      [22, 13, 3],
      [20, 13, 2],
      [24, 13, 2],
      [21, 13, 1],
    ]);
  });
});

describe('the prefilter', () => {
  it('keeps an RB who gains by pushing a WR into WR/TE, though he beats no starter at his slot', () => {
    const tight = [slot('RB/WR', 1, ['RB', 'WR']), slot('WR/TE', 1, ['WR', 'TE'])];
    const team = [rostered(1, 'WR', [10]), rostered(2, 'TE', [3])];
    const projectionFor = (p: WaiverPlayer, w: number) => p.projections[w] ?? 0;
    const weakest = weakestStarters(team, tight, [1], projectionFor);
    expect(weakest.get(1)).toBe(3);
    expect(mightHelp(available(3, 'RB', [5]), weakest, projectionFor)).toBe(true);

    const advice = waiverAdvice({ roster: team, available: [available(3, 'RB', [5])], slots: tight, weeks: [1], rosterSize: 3 });
    expect(advice.suggestions[0].gain).toBe(2);
  });

  it('skips a player who beats no starter in any week', () => {
    const advice = waiverAdvice({ roster, available: [available(10, 'WR', [8, 0])], slots, weeks, rosterSize: 6 });
    expect(advice.skipped).toBe(1);
    expect(advice.evaluated).toBe(0);
  });

  it('treats an empty slot as a 0-point starter', () => {
    const projectionFor = (p: WaiverPlayer, w: number) => p.projections[w] ?? 0;
    expect(weakestStarters(roster, slots, weeks, projectionFor)).toEqual(new Map([[1, 9], [2, 0]]));
  });

  it('never skips a pickup that would gain, on random rosters', () => {
    // A small deterministic generator, so a failure always reproduces.
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const positions = ['QB', 'RB', 'WR'];
    const points = () => [0, 1].map(() => (random() < 0.2 ? 0 : Math.round(random() * 20)));
    let suggested = 0;
    let skipped = 0;
    for (let trial = 0; trial < 200; trial++) {
      const team = Array.from({ length: 6 }, (_, i) => rostered(i + 1, positions[Math.floor(random() * 3)], points()));
      const pool = Array.from({ length: 5 }, (_, i) => available(100 + i, positions[Math.floor(random() * 3)], points()));
      const advice = waiverAdvice({ roster: team, available: pool, slots, weeks, rosterSize: 7 });
      const before = valueOf(team, weeks);
      suggested += advice.suggestions.length;
      skipped += advice.skipped;
      for (const p of pool) {
        const gain = valueOf([...team, p], weeks) - before;
        const suggestion = advice.suggestions.find((s) => s.player.playerId === p.playerId);
        if (gain >= MIN_GAIN) expect(suggestion?.gain).toBe(gain);
        else expect(suggestion).toBeUndefined();
      }
    }
    // Both sides of the filter were exercised.
    expect(suggested).toBeGreaterThan(100);
    expect(skipped).toBeGreaterThan(100);
  });
});

describe('the drop search', () => {
  it('breaks a tie in cost by dropping whoever is projected for less', () => {
    // Neither the backup QB (12 a week) nor an injured WR (0) ever starts, so both cost nothing.
    const team = [...roster.filter((p) => p.playerId !== 6), rostered(6, 'WR', [0, 0])];
    const [pickup] = waiverAdvice({ roster: team, available: [available(10, 'WR', [11, 11])], slots, weeks, rosterSize: 6 })
      .suggestions;
    expect(pickup.drop?.playerId).toBe(6);
    expect(pickup.alternative?.drop.playerId).toBe(2);
    expect(pickup.alternative?.gain).toBe(pickup.gain);
  });

  it('finds the same best and next-best gains as trying every drop, on random full rosters', () => {
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const positions = ['QB', 'RB', 'WR'];
    const points = () => [0, 1, 2].map(() => (random() < 0.2 ? 0 : Math.round(random() * 20)));
    const threeWeeks = [1, 2, 3];
    let checked = 0;
    for (let trial = 0; trial < 150; trial++) {
      const team = Array.from({ length: 7 }, (_, i) =>
        rostered(i + 1, positions[Math.floor(random() * 3)], points(), { droppable: random() > 0.15 }),
      );
      const pool = Array.from({ length: 4 }, (_, i) => available(100 + i, positions[Math.floor(random() * 3)], points()));
      const advice = waiverAdvice({ roster: team, available: pool, slots, weeks: threeWeeks, rosterSize: 7 });
      const before = valueOf(team, threeWeeks);
      for (const p of pool) {
        const gains = team
          .filter((d) => d.droppable)
          .map((d) => valueOf([...team.filter((q) => q !== d), p], threeWeeks) - before)
          .sort((a, b) => b - a);
        const suggestion = advice.suggestions.find((s) => s.player.playerId === p.playerId);
        if (!gains.length || gains[0] < MIN_GAIN) {
          expect(suggestion).toBeUndefined();
          continue;
        }
        checked++;
        expect(suggestion?.gain).toBeCloseTo(gains[0], 9);
        if (gains.length > 1) expect(suggestion?.alternative?.gain).toBeCloseTo(gains[1], 9);
        else expect(suggestion?.alternative).toBeNull();
        expect(valueOf([...team.filter((q) => q !== suggestion!.drop), p], threeWeeks) - before).toBeCloseTo(gains[0], 9);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('forPosition', () => {
  const suggestions = Array.from({ length: 40 }, (_, i) => ({ player: available(i, i % 2 ? 'RB' : 'WR', [1]) }));

  it('cuts all positions to MAX_SUGGESTIONS', () => {
    expect(forPosition(suggestions, null)).toHaveLength(MAX_SUGGESTIONS);
  });

  it('filters one position, keeping the order', () => {
    const rbs = forPosition(suggestions, 'RB');
    expect(rbs).toHaveLength(20);
    expect(rbs.every((s) => s.player.position === 'RB')).toBe(true);
    expect(rbs[0].player.playerId).toBe(1);
  });
});

function player(overrides: Partial<Player>): Player {
  return {
    playerId: 1,
    fullName: 'Test Player',
    position: 'RB',
    proTeam: 'DET',
    slot: 'BE',
    starter: false,
    injuryStatus: null,
    headshotUrl: '',
    isTeamLogo: false,
    projectedPoints: 10,
    points: 0,
    opponent: 'CHI',
    opponentIsHome: true,
    gameTimeUtc: '2026-10-18T17:00:00Z',
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

describe('droppable', () => {
  const starting = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']);

  it('lets an unlocked bench or starting player go', () => {
    expect(droppable(player({}), starting, false)).toBe(true);
    expect(droppable(player({ slot: 'RB', starter: true }), starting, false)).toBe(true);
  });

  it('keeps IR, IDP and locked players', () => {
    expect(droppable(player({ slot: 'IR' }), starting, false)).toBe(false);
    expect(droppable(player({ position: 'LB' }), starting, false)).toBe(false);
    expect(droppable(player({}), starting, true)).toBe(false);
  });
});

describe('proTeamLocked', () => {
  const game = (home: string, away: string, kickoffUtc: string, state: NflGame['state'] = 'pre') =>
    ({ kickoffUtc, state, home: { abbrev: home }, away: { abbrev: away } }) as NflGame;
  const games = [game('DET', 'CHI', '2026-10-18T17:00:00Z'), game('SF', 'SEA', '2026-10-16T00:15:00Z', 'post')];
  const now = new Date('2026-10-18T16:00:00Z');

  it('locks a team once its game has kicked off or finished', () => {
    expect(proTeamLocked('CHI', games, now)).toBe(false);
    expect(proTeamLocked('CHI', games, new Date('2026-10-18T17:00:00Z'))).toBe(true);
    expect(proTeamLocked('SEA', games, now)).toBe(true);
  });

  it('never locks a team on bye', () => {
    expect(proTeamLocked('KC', games, now)).toBe(false);
  });
});
