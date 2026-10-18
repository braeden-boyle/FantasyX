import { describe, expect, it } from 'vitest';
import { LineupSlot } from '../models/team.model';
import {
  EVEN_MARGIN,
  MAX_EXACT_DROPS,
  Trade,
  afterTrade,
  bestDrops,
  missingPicks,
  sideValue,
  tradeAnalysis,
  tradeLabel,
  tradeOutcome,
  tradeWeeks,
} from './trades';
import { RosterEntry } from './waivers';

const slot = (name: string, count: number, eligiblePositions: string[]): LineupSlot => ({ slot: name, count, eligiblePositions });

// QB, RB, WR and a RB/WR flex: small enough to work out by hand.
const slots = [slot('QB', 1, ['QB']), slot('RB', 1, ['RB']), slot('WR', 1, ['WR']), slot('FLEX', 1, ['RB', 'WR'])];

// Projections by week, from a list ([20, 0, 5] is 20 in week 1, 0 in week 2 and 5 in week 3).
const byWeek = (points: number[]): Record<number, number> => Object.fromEntries(points.map((p, i) => [i + 1, p]));

function player(playerId: number, position: string, points: number[], overrides: Partial<RosterEntry> = {}): RosterEntry {
  return { playerId, position, projections: byWeek(points), injuredReserve: false, droppable: true, ...overrides };
}

// This week is 1, so the trade counts in weeks 2 and 3.
const weeks = tradeWeeks(1, 3);

// Two full rosters of six. Yours: QB 20, RBs 15 and 9, WRs 14 and 7, and a backup QB who never plays.
// Theirs: QB 18, RBs 10 and 8, WRs 16, 13 and 6.
const mine = [
  player(1, 'QB', [20, 20, 20]),
  player(2, 'RB', [15, 15, 15]),
  player(3, 'RB', [9, 9, 9]),
  player(4, 'WR', [14, 14, 14]),
  player(5, 'WR', [7, 7, 7]),
  player(6, 'QB', [12, 12, 12]),
];
const theirs = [
  player(11, 'QB', [18, 18, 18]),
  player(12, 'RB', [10, 10, 10]),
  player(13, 'RB', [8, 8, 8]),
  player(14, 'WR', [16, 16, 16]),
  player(15, 'WR', [13, 13, 13]),
  player(16, 'WR', [6, 6, 6]),
];

const trade = (send: number[], get: number[]): Trade => ({ partnerId: 2, send, get });
const analyze = (t: Trade, overrides: { mine?: RosterEntry[]; theirs?: RosterEntry[]; rosterSize?: number; irSlots?: number } = {}) =>
  tradeAnalysis({
    mine: overrides.mine ?? mine,
    theirs: overrides.theirs ?? theirs,
    trade: t,
    slots,
    weeks,
    rosterSize: overrides.rosterSize ?? 6,
    irSlots: overrides.irSlots ?? 1,
  })!;
const valueOf = (players: readonly RosterEntry[], w: readonly number[] = weeks) => sideValue(players, slots, w).total;
const ids = (players: readonly RosterEntry[]) => players.map((p) => p.playerId).sort((a, b) => a - b);

describe('tradeWeeks', () => {
  it('starts next week, and is empty in the last week', () => {
    expect(tradeWeeks(7, 17)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(tradeWeeks(17, 17)).toEqual([]);
  });
});

describe('tradeAnalysis', () => {
  it('values each side as roster value after minus before, from next week', () => {
    // Your RB (9) for their WR (13). You: 20+15+14+9 = 58 a week, then 20+15+14+13 = 62, so +8 over two
    // weeks. Them: 18+10+16+13 = 57, then 18+10+16+9 = 53, so -8.
    const a = analyze(trade([3], [15]));
    expect(a.weeks).toEqual([2, 3]);
    expect(a.you.before.total).toBe(116);
    expect(a.you.gain).toBe(8);
    expect(a.them.gain).toBe(-8);
    expect(a.you.gain).toBe(valueOf([...mine.filter((p) => p.playerId !== 3), theirs[4]]) - valueOf(mine));
    expect(a.them.gain).toBe(valueOf([...theirs.filter((p) => p.playerId !== 15), mine[2]]) - valueOf(theirs));
    expect([a.you.outcome, a.them.outcome]).toEqual(['gains', 'loses']);
    expect(a.label).toBe('You gain, they lose');
  });

  it('ignores this week', () => {
    // Their WR is out this week only, which a trade can't use anyway.
    const hurt = theirs.map((p) => (p.playerId === 15 ? player(15, 'WR', [0, 13, 13]) : p));
    expect(analyze(trade([3], [15]), { theirs: hurt }).you.gain).toBe(8);
  });

  it('reads a swap of identical players as even, and swapping back restores both rosters', () => {
    const twin = player(17, 'RB', [9, 9, 9]);
    const a = analyze(trade([3], [17]), { theirs: [...theirs.slice(0, 5), twin] });
    expect(a.you.gain).toBe(0);
    expect(a.them.gain).toBe(0);
    expect(a.label).toBe('About even for both');

    const mineAfter = afterTrade(mine, [3], [theirs[4]], 1);
    const theirsAfter = afterTrade(theirs, [15], [mine[2]], 1);
    const back = tradeAnalysis({ mine: mineAfter, theirs: theirsAfter, trade: trade([15], [3]), slots, weeks, rosterSize: 6, irSlots: 1 })!;
    expect(back.you.after.total).toBe(valueOf(mine));
    expect(back.them.after.total).toBe(valueOf(theirs));
  });

  it('drops the cheapest player from the side getting two, and leaves the other with an open spot', () => {
    // Your RB (9) for their two RBs (10 and 8). You'd have seven, and drop your low WR: neither he nor
    // the backup QB starts, and he's projected for less. They'd have five and an open spot.
    const a = analyze(trade([3], [12, 13]));
    expect(ids(a.you.drops)).toEqual([5]);
    expect(a.you.openSpots).toBe(0);
    expect(a.them.drops).toEqual([]);
    expect(a.them.openSpots).toBe(1);
    // You: 20+15+14+10 = 59 a week, +1. Them: 18+9+16+13 = 56 a week, -1.
    expect(a.you.gain).toBe(2);
    expect(a.them.gain).toBe(-2);
  });

  it('never drops a player just received, an IR player or one no slot takes', () => {
    // Your QB for their QB and a 2-point RB. The received RB would be the cheapest drop, and the
    // backup QB (marked undroppable, like an IDP player) and an IR WR would cost nothing, but none of
    // them can go, so your low WR does.
    const guarded = mine.map((p) => (p.playerId === 6 ? { ...p, droppable: false } : p));
    const injured = player(7, 'WR', [0, 0, 0], { injuredReserve: true, droppable: false });
    const weak = theirs.map((p) => (p.playerId === 13 ? player(13, 'RB', [2, 2, 2]) : p));
    const a = analyze(trade([1], [11, 13]), { mine: [...guarded, injured], theirs: weak });
    expect(a.you.drops.map((p) => p.playerId)).not.toContain(13);
    expect(a.you.drops.map((p) => p.playerId)).not.toContain(11);
    expect(a.you.drops.map((p) => p.playerId)).not.toContain(6);
    expect(a.you.drops.map((p) => p.playerId)).not.toContain(7);
    expect(ids(a.you.drops)).toEqual([5]);
  });

  it('shows a bye as that week’s dip in the gains', () => {
    // Their WR is on bye in week 3, so your low WR fills in for the RB you sent: 2 down that week.
    const bye = theirs.map((p) => (p.playerId === 15 ? player(15, 'WR', [13, 13, 0]) : p));
    const a = analyze(trade([3], [15]), { theirs: bye });
    expect(a.you.gainByWeek).toEqual(new Map([[2, 4], [3, -2]]));
  });

  it('starts an incoming player in next week’s lineup, in the right slot', () => {
    // Your QB (20) for theirs (18): he starts at QB, and your RB (9) stays in the flex.
    const a = analyze(trade([1], [11]));
    const seated = (lineup: typeof a.you.lineupAfter, name: string) => lineup.starters.find((s) => s.slot.slot === name)?.player?.playerId;
    expect(seated(a.you.lineupBefore, 'QB')).toBe(1);
    expect(seated(a.you.lineupAfter, 'QB')).toBe(11);
    expect(seated(a.you.lineupAfter, 'FLEX')).toBe(3);
    expect(a.you.lineupAfter.total - a.you.lineupBefore.total).toBe(a.you.gainByWeek.get(2));
  });

  it('waits for a player on both sides', () => {
    expect(tradeAnalysis({ mine, theirs, trade: trade([3], []), slots, weeks, rosterSize: 6, irSlots: 1 })).toBeNull();
    expect(tradeAnalysis({ mine, theirs, trade: trade([3], [15]), slots, weeks: [], rosterSize: 6, irSlots: 1 })).toBeNull();
  });

  it('leaves out picks no longer on a roster', () => {
    expect(missingPicks(trade([3, 99], [15, 98]), mine, theirs)).toEqual([99, 98]);
    expect(analyze(trade([3, 99], [15])).you.sent.map((p) => p.playerId)).toEqual([3]);
  });
});

describe('IR players', () => {
  // Your star RB is on IR, out in week 2 and back for 25 in week 3.
  const star = player(8, 'RB', [0, 0, 25], { injuredReserve: true, droppable: false });

  it('cost their return weeks when traded away', () => {
    const withStar = [...mine, star];
    // Before: 58 in week 2, then 20+25+14+15 = 74 in week 3. Trading him for their low WR (6) changes
    // nothing in week 2 and costs 16 in week 3.
    const a = analyze(trade([8], [16]), { mine: withStar });
    expect(a.you.gainByWeek).toEqual(new Map([[2, 0], [3, -16]]));
    expect(a.you.gain).toBe(-16);
  });

  it('take no roster spot while on IR, and come off it when the IR slots are full', () => {
    // Their WR6 for your WR7 is 1-for-1. Getting their IR star as well, with your IR slot free, he
    // goes to IR and nobody is dropped.
    const theirsWithStar = [...theirs, { ...star, playerId: 18 }];
    const free = analyze(trade([5], [16, 18]), { theirs: theirsWithStar });
    expect(free.you.drops).toEqual([]);
    expect(free.you.received.find((p) => p.playerId === 18)?.injuredReserve).toBe(true);

    // With your IR slot taken, he takes a bench spot, so you're over and drop the backup QB.
    const ir = player(9, 'WR', [0, 0, 0], { injuredReserve: true, droppable: false });
    const full = analyze(trade([5], [16, 18]), { mine: [...mine, ir], theirs: theirsWithStar });
    expect(full.you.received.find((p) => p.playerId === 18)?.injuredReserve).toBe(false);
    expect(ids(full.you.drops)).toEqual([6]);
  });

  it('afterTrade fills IR slots in the order received', () => {
    const a = player(21, 'RB', [0, 0, 0], { injuredReserve: true });
    const b = player(22, 'RB', [0, 0, 0], { injuredReserve: true });
    const after = afterTrade(mine, [3], [a, b], 1);
    expect(after.find((p) => p.playerId === 21)?.injuredReserve).toBe(true);
    expect(after.find((p) => p.playerId === 22)?.injuredReserve).toBe(false);
    // Sending away your own IR player frees the slot.
    const own = player(23, 'WR', [0, 0, 0], { injuredReserve: true });
    expect(afterTrade([...mine, own], [23], [b], 1).find((p) => p.playerId === 22)?.injuredReserve).toBe(true);
  });
});

describe('bestDrops', () => {
  it('drops nobody with an unknown roster size or room to spare', () => {
    expect(bestDrops([...mine, theirs[0]], [theirs[0]], 0, slots, weeks)).toEqual([]);
    expect(bestDrops(mine, [], 6, slots, weeks)).toEqual([]);
  });

  it('breaks a tie in cost by dropping whoever is projected for less', () => {
    // Neither the backup QB (12) nor a WR projected at 0 ever starts, so both cost nothing.
    const zero = player(7, 'WR', [0, 0, 0]);
    expect(ids(bestDrops([...mine, zero], [], 6, slots, weeks))).toEqual([7]);
  });

  it('matches brute force on random rosters, with 1, 2 and 3 drops', () => {
    // A small deterministic generator, so a failure always reproduces.
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const positions = ['QB', 'RB', 'WR'];
    const points = () => [0, 1, 2].map(() => (random() < 0.2 ? 0 : Math.round(random() * 20)));
    for (const over of [1, 2, 3]) {
      for (let trial = 0; trial < 60; trial++) {
        const team = Array.from({ length: 6 + over }, (_, i) =>
          player(i + 1, positions[Math.floor(random() * 3)], points(), { droppable: random() > 0.1 }),
        );
        const received = team.slice(0, over);
        const drops = bestDrops(team, received, 6, slots, weeks);
        const candidates = team.filter((p) => p.droppable && !received.includes(p));
        expect(drops.length).toBe(Math.min(over, candidates.length));
        expect(drops.every((d) => candidates.includes(d))).toBe(true);
        if (candidates.length <= over) continue;
        const best = Math.max(...combinations(candidates, over).map((c) => valueOf(team.filter((p) => !c.includes(p)))));
        expect(valueOf(team.filter((p) => !drops.includes(p)))).toBeCloseTo(best, 9);
      }
    }
  });

  it('drops one at a time, cheapest first, beyond the exact limit', () => {
    const extra = Array.from({ length: MAX_EXACT_DROPS + 1 }, (_, i) => player(30 + i, 'QB', [0, i, i]));
    // Each extra QB never starts, so dropping them costs nothing; the lowest-projected go first.
    expect(ids(bestDrops([...mine, ...extra], [], 6, slots, weeks))).toEqual([30, 31, 32, 33]);
  });
});

describe('outcomes and labels', () => {
  it('reads gains within EVEN_MARGIN as about even', () => {
    expect(tradeOutcome(EVEN_MARGIN)).toBe('even');
    expect(tradeOutcome(-EVEN_MARGIN)).toBe('even');
    expect(tradeOutcome(EVEN_MARGIN + 0.1)).toBe('gains');
    expect(tradeOutcome(-EVEN_MARGIN - 0.1)).toBe('loses');
  });

  it('puts both sides in one line', () => {
    expect(tradeLabel('gains', 'gains')).toBe('Good for both');
    expect(tradeLabel('gains', 'loses')).toBe('You gain, they lose');
    expect(tradeLabel('even', 'gains')).toBe('About even for you, they gain');
    expect(tradeLabel('loses', 'even')).toBe('You lose, about even for them');
    expect(tradeLabel('loses', 'loses')).toBe('Bad for both');
  });
});

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  return items.flatMap((item, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [item, ...rest]));
}
