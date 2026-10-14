import { describe, expect, it } from 'vitest';
import { LineupSlot } from '../models/team.model';
import { LineupPlayer, bestLineupTotal, optimalLineup, rosterValue, slotFillOrder } from './lineup';

const slot = (name: string, count: number, eligiblePositions: string[]): LineupSlot => ({ slot: name, count, eligiblePositions });

const standard = [
  slot('QB', 1, ['QB']),
  slot('RB', 2, ['RB']),
  slot('WR', 2, ['WR']),
  slot('TE', 1, ['TE']),
  slot('FLEX', 1, ['RB', 'WR', 'TE']),
];

function player(playerId: number, position: string, projected: number, overrides: Partial<LineupPlayer> = {}): LineupPlayer {
  return { playerId, position, projected, slot: null, locked: false, ...overrides };
}

// Who sits in each slot, as "slot:playerId" in fill order, with "-" for an empty slot.
const seats = (players: readonly LineupPlayer[], slots: readonly LineupSlot[]) =>
  optimalLineup(players, slots).starters.map((s) => `${s.slot.slot}:${s.player?.playerId ?? '-'}`);

describe('slotFillOrder', () => {
  it('expands counts and puts the most restrictive slots first', () => {
    expect(slotFillOrder(standard).map((s) => s.slot)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']);
  });
});

describe('optimalLineup', () => {
  it('fills a standard lineup the way the greedy fill does', () => {
    const players = [
      player(1, 'QB', 20),
      player(2, 'QB', 18),
      player(3, 'RB', 15),
      player(4, 'RB', 13),
      player(5, 'RB', 11),
      player(6, 'WR', 14),
      player(7, 'WR', 12),
      player(8, 'WR', 10),
      player(9, 'TE', 9),
    ];
    const lineup = optimalLineup(players, standard);
    expect(seats(players, standard)).toEqual(['QB:1', 'RB:3', 'RB:4', 'WR:6', 'WR:7', 'TE:9', 'FLEX:5']);
    expect(lineup.total).toBe(20 + 15 + 13 + 14 + 12 + 9 + 11);
    expect(lineup.bench.map((p) => p.playerId)).toEqual([2, 8]);
  });

  it('beats the greedy fill when slots overlap without nesting', () => {
    // Greedy fills RB/WR first with the WR (20), leaving WR/TE the TE (5): 25. Best is RB 10 + WR 20.
    const slots = [slot('RB/WR', 1, ['RB', 'WR']), slot('WR/TE', 1, ['WR', 'TE'])];
    const players = [player(1, 'WR', 20), player(2, 'RB', 10), player(3, 'TE', 5)];
    expect(optimalLineup(players, slots).total).toBe(30);
    expect(seats(players, slots)).toEqual(['RB/WR:2', 'WR/TE:1']);
  });

  it('starts a second QB in a superflex OP slot', () => {
    const slots = [slot('QB', 1, ['QB']), slot('RB', 1, ['RB']), slot('OP', 1, ['QB', 'RB', 'WR', 'TE'])];
    const players = [player(1, 'QB', 25), player(2, 'QB', 20), player(3, 'RB', 15), player(4, 'RB', 12)];
    expect(seats(players, slots)).toEqual(['QB:1', 'RB:3', 'OP:2']);
  });

  it('keeps locked starters in their slot and never starts a locked bench player', () => {
    const players = [
      player(1, 'RB', 5, { slot: 'RB', locked: true }),
      player(2, 'RB', 9, { slot: 'RB' }),
      player(3, 'RB', 30, { locked: true }),
      player(4, 'RB', 12),
    ];
    const slots = [slot('RB', 2, ['RB'])];
    const lineup = optimalLineup(players, slots);
    expect(lineup.starters.map((s) => s.player?.playerId)).toEqual([1, 4]);
    expect(lineup.bench.map((p) => p.playerId)).toEqual([2, 3]);
    expect(lineup.total).toBe(17);
  });

  it('fills an empty slot when someone can play it, and leaves it empty otherwise', () => {
    const slots = [slot('QB', 1, ['QB']), slot('K', 1, ['K'])];
    expect(seats([player(1, 'QB', 20), player(2, 'K', 8)], slots)).toEqual(['QB:1', 'K:2']);
    expect(seats([player(1, 'QB', 20), player(2, 'WR', 8)], slots)).toEqual(['QB:1', 'K:-']);
  });

  it('keeps the current lineup when a bench player only ties a starter', () => {
    const players = [player(1, 'WR', 10, { slot: 'WR' }), player(2, 'WR', 10)];
    expect(seats(players, [slot('WR', 1, ['WR'])])).toEqual(['WR:1']);
    const reversed = [player(2, 'WR', 10), player(1, 'WR', 10, { slot: 'WR' })];
    expect(seats(reversed, [slot('WR', 1, ['WR'])])).toEqual(['WR:1']);
  });

  it('keeps a starter on bye when nobody can replace them, but never starts a bench player on bye', () => {
    const slots = [slot('TE', 1, ['TE'])];
    expect(seats([player(1, 'TE', 0, { slot: 'TE' }), player(2, 'TE', 0)], slots)).toEqual(['TE:1']);
    expect(seats([player(2, 'TE', 0)], slots)).toEqual(['TE:-']);
  });

  it('benches the flex for a better bench player at another position', () => {
    const slots = [slot('RB', 1, ['RB']), slot('FLEX', 1, ['RB', 'WR', 'TE'])];
    const players = [player(1, 'RB', 12, { slot: 'RB' }), player(2, 'WR', 8, { slot: 'FLEX' }), player(3, 'RB', 15)];
    // Either RB can take either slot for 27; ties keep player 1 in RB.
    expect(seats(players, slots)).toEqual(['RB:1', 'FLEX:3']);
    expect(optimalLineup(players, slots).total).toBe(27);
  });
});

describe('bestLineupTotal', () => {
  it('ignores players projected at 0', () => {
    expect(bestLineupTotal([{ playerId: 1, position: 'QB', projected: 0 }], [slot('QB', 1, ['QB'])])).toBe(0);
  });
});

describe('rosterValue', () => {
  const slots = [slot('QB', 1, ['QB']), slot('WR', 1, ['WR'])];
  const roster = [
    { playerId: 1, position: 'QB', slot: 'QB' },
    { playerId: 2, position: 'QB', slot: 'BE' },
    { playerId: 3, position: 'WR', slot: 'WR' },
    { playerId: 4, position: 'WR', slot: 'IR' },
  ];
  // Player 1 is on bye in week 6; player 4 (IR) would outscore everyone.
  const projections: Record<number, Record<number, number>> = {
    1: { 5: 20, 6: 0, 7: 20 },
    2: { 5: 15, 6: 15, 7: 15 },
    3: { 5: 10, 6: 10, 7: 10 },
    4: { 5: 50, 6: 50, 7: 50 },
  };

  it("sums each week's best lineup, with a bye costing only that week", () => {
    const value = rosterValue(roster, slots, [5, 6, 7], (p, week) => projections[p.playerId][week]);
    expect([...value.byWeek]).toEqual([[5, 30], [6, 25], [7, 30]]);
    expect(value.total).toBe(85);
  });

  it('leaves out IR', () => {
    const value = rosterValue(roster, slots, [5], (p, week) => projections[p.playerId][week]);
    expect(value.total).toBe(30);
  });
});
