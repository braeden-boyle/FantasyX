import { describe, expect, it } from 'vitest';
import { LineupSlot, Player } from '../models/team.model';
import { LineupPlayer, optimalLineup } from './lineup';
import { TOSS_UP_PERCENT, chanceToOutscore, currentLineup, isLocked, lineupChanges, startSitAdvice } from './start-sit';
import { espnProjection } from './win-probability';

const NOW = new Date('2026-10-18T16:00:00Z');
const LATER = '2026-10-18T20:25:00Z';
const EARLIER = '2026-10-18T13:00:00Z';

const slot = (name: string, count: number, eligiblePositions: string[]): LineupSlot => ({ slot: name, count, eligiblePositions });
const slots = [slot('QB', 1, ['QB']), slot('RB', 1, ['RB']), slot('WR', 1, ['WR']), slot('FLEX', 1, ['RB', 'WR', 'TE'])];

function player(playerId: number, position: string, projectedPoints: number, overrides: Partial<Player> = {}): Player {
  return {
    playerId,
    fullName: `Player ${playerId}`,
    position,
    proTeam: 'KC',
    slot: 'BE',
    starter: false,
    injuryStatus: null,
    headshotUrl: '',
    isTeamLogo: false,
    projectedPoints,
    points: 0,
    opponent: 'BUF',
    opponentIsHome: true,
    gameTimeUtc: LATER,
    opponentPositionRank: null,
    gameFinal: false,
    statLine: null,
    gameState: 'pre',
    gameDetail: null,
    possessionTeam: null,
    redZone: false,
    ...overrides,
  };
}

const starter = (playerId: number, position: string, projected: number, slotName: string, overrides: Partial<Player> = {}) =>
  player(playerId, position, projected, { slot: slotName, starter: true, ...overrides });

const advise = (players: Player[], lineupSlots = slots) =>
  startSitAdvice({ players, slots: lineupSlots, projectionOf: espnProjection, residualsOf: null, now: NOW });

describe('isLocked', () => {
  it('locks at kickoff, and for games in progress or over', () => {
    expect(isLocked(player(1, 'WR', 10), NOW)).toBe(false);
    expect(isLocked(player(1, 'WR', 10, { gameTimeUtc: EARLIER }), NOW)).toBe(true);
    expect(isLocked(player(1, 'WR', 10, { gameState: 'in' }), NOW)).toBe(true);
    expect(isLocked(player(1, 'WR', 10, { gameFinal: true }), NOW)).toBe(true);
  });

  it('never locks a player on bye', () => {
    expect(isLocked(player(1, 'WR', 0, { opponent: null, gameTimeUtc: null, gameState: null }), NOW)).toBe(false);
  });
});

describe('chanceToOutscore', () => {
  const a = { projected: 15, spread: 7 };
  const b = { projected: 12, spread: 6 };

  it('is even for identical players', () => {
    expect(chanceToOutscore(a, a)).toBeCloseTo(0.5, 6);
  });

  it('is symmetric', () => {
    expect(chanceToOutscore(a, b) + chanceToOutscore(b, a)).toBeCloseTo(1, 6);
  });

  it('rises with the projection gap', () => {
    expect(chanceToOutscore(a, b)).toBeGreaterThan(0.5);
    expect(chanceToOutscore({ ...a, projected: 20 }, b)).toBeGreaterThan(chanceToOutscore(a, b));
  });
});

describe('lineupChanges', () => {
  const lp = (playerId: number, position: string, projected: number, slotName: string | null = null): LineupPlayer => ({
    playerId,
    position,
    projected,
    slot: slotName,
    locked: false,
  });

  it('pairs a one-for-one swap at the same position', () => {
    const players = [lp(1, 'QB', 20, 'QB'), lp(2, 'RB', 8, 'RB'), lp(3, 'RB', 14), lp(4, 'WR', 10, 'WR'), lp(5, 'TE', 6, 'FLEX')];
    const moves = lineupChanges(currentLineup(players, slots).starters, optimalLineup(players, slots).starters);
    expect(moves.map((m) => [m.in?.playerId, m.out?.playerId])).toEqual([[3, 5]]);
  });

  it('pairs a chain by position: bench RB in, the flex TE out', () => {
    // Best: RB 14 in RB, RB 12 moves to FLEX, TE 6 sits.
    const players = [lp(1, 'QB', 20, 'QB'), lp(2, 'RB', 12, 'RB'), lp(3, 'RB', 14), lp(4, 'WR', 10, 'WR'), lp(5, 'TE', 6, 'FLEX')];
    const moves = lineupChanges(currentLineup(players, slots).starters, optimalLineup(players, slots).starters);
    expect(moves).toHaveLength(1);
    expect(moves[0].in?.playerId).toBe(3);
    expect(moves[0].out?.playerId).toBe(5);
  });

  it('pairs two swaps at the right positions', () => {
    const players = [lp(1, 'QB', 20, 'QB'), lp(2, 'RB', 5, 'RB'), lp(3, 'WR', 4, 'WR'), lp(4, 'WR', 15), lp(5, 'RB', 16), lp(6, 'TE', 9, 'FLEX')];
    const moves = lineupChanges(currentLineup(players, slots).starters, optimalLineup(players, slots).starters);
    const pairs = moves.map((m) => [m.in?.playerId, m.out?.playerId]);
    expect(pairs).toEqual([[5, 2], [4, 3]]);
  });

  it('leaves an empty-slot fill unpaired', () => {
    const players = [lp(1, 'QB', 20, 'QB'), lp(2, 'RB', 12, 'RB'), lp(4, 'WR', 10, 'WR'), lp(5, 'TE', 6)];
    const moves = lineupChanges(currentLineup(players, slots).starters, optimalLineup(players, slots).starters);
    expect(moves).toEqual([{ in: players[3], inSlot: 'FLEX', out: null, outSlot: null }]);
  });
});

describe('startSitAdvice', () => {
  it('suggests nothing when the lineup is already the best', () => {
    const advice = advise([
      starter(1, 'QB', 20, 'QB'),
      starter(2, 'RB', 15, 'RB'),
      starter(3, 'WR', 14, 'WR'),
      starter(4, 'RB', 12, 'FLEX'),
      player(5, 'WR', 9),
    ]);
    expect(advice.changes).toEqual([]);
    expect(advice.gain).toBe(0);
    expect(advice.verdicts.get(5)).toBe('Sit');
    expect(advice.verdicts.get(4)).toBe('Start');
  });

  it('suggests a better bench player, with the gain and chance', () => {
    const advice = advise([
      starter(1, 'QB', 20, 'QB'),
      starter(2, 'RB', 15, 'RB'),
      starter(3, 'WR', 14, 'WR'),
      starter(4, 'TE', 6, 'FLEX'),
      player(5, 'WR', 13),
    ]);
    expect(advice.gain).toBeCloseTo(7, 6);
    expect(advice.bestTotal).toBeCloseTo(62, 6);
    expect(advice.changes).toHaveLength(1);
    const [change] = advice.changes;
    expect([change.in?.playerId, change.out?.playerId]).toEqual([5, 4]);
    expect(change.chance).toBeGreaterThan(0.75);
    expect(change.tossUp).toBe(false);
    expect(advice.verdicts.get(4)).toBe('Sit');
    expect(advice.verdicts.get(5)).toBe('Start');
  });

  it(`labels a change under ${TOSS_UP_PERCENT}% a toss-up`, () => {
    const advice = advise([
      starter(1, 'QB', 20, 'QB'),
      starter(2, 'RB', 15, 'RB'),
      starter(3, 'WR', 10, 'WR'),
      starter(4, 'RB', 12, 'FLEX'),
      player(5, 'WR', 10.5),
    ]);
    expect(advice.changes).toHaveLength(1);
    expect(advice.changes[0].tossUp).toBe(true);
  });

  it('replaces a starter on bye, and warns when nobody can', () => {
    const bye = { opponent: null, gameTimeUtc: null, gameState: null, projectedPoints: 0 };
    const withBackup = advise([
      starter(1, 'QB', 0, 'QB', bye),
      player(2, 'QB', 14),
      starter(3, 'RB', 15, 'RB'),
      starter(4, 'WR', 14, 'WR'),
      starter(5, 'RB', 12, 'FLEX'),
    ]);
    expect(withBackup.changes.map((c) => [c.in?.playerId, c.out?.playerId])).toEqual([[2, 1]]);
    expect(withBackup.warnings).toEqual([]);
    expect(withBackup.verdicts.get(1)).toBe('Bye');

    const noBackup = advise([starter(1, 'QB', 0, 'QB', bye), starter(3, 'RB', 15, 'RB'), starter(4, 'WR', 14, 'WR'), starter(5, 'RB', 12, 'FLEX')]);
    expect(noBackup.changes).toEqual([]);
    expect(noBackup.warnings.map((w) => [w.slot, w.player.playerId, w.reason])).toEqual([['QB', 1, 'bye']]);
  });

  it('warns about an Out starter with no backup', () => {
    const advice = advise([
      starter(1, 'QB', 20, 'QB'),
      starter(2, 'RB', 0, 'RB', { injuryStatus: 'OUT' }),
      starter(3, 'WR', 14, 'WR'),
      starter(4, 'WR', 12, 'FLEX'),
    ]);
    expect(advice.warnings.map((w) => w.reason)).toEqual(['out']);
    expect(advice.verdicts.get(2)).toBe('Out');
  });

  it('leaves locked players where they are', () => {
    const advice = advise([
      starter(1, 'QB', 20, 'QB'),
      starter(2, 'RB', 5, 'RB', { gameTimeUtc: EARLIER, gameState: 'in' }),
      player(3, 'RB', 18),
      starter(4, 'WR', 14, 'WR'),
      starter(5, 'WR', 8, 'FLEX'),
      player(6, 'WR', 30, { gameTimeUtc: EARLIER, gameState: 'in' }),
    ]);
    expect(advice.changes.map((c) => [c.in?.playerId, c.out?.playerId])).toEqual([[3, 5]]);
    expect(advice.verdicts.get(2)).toBe('Locked');
    expect(advice.verdicts.get(6)).toBe('Locked');
    expect(advice.allLocked).toBe(false);
  });

  it('says when everything is locked', () => {
    const locked = { gameTimeUtc: EARLIER, gameState: 'post' as const, gameFinal: true };
    const advice = advise([starter(1, 'QB', 20, 'QB', locked), player(2, 'QB', 30, locked)]);
    expect(advice.allLocked).toBe(true);
    expect(advice.changes).toEqual([]);
  });

  it('never starts IR, and leaves starters in slots the settings skip', () => {
    const advice = advise([
      starter(1, 'QB', 20, 'QB'),
      starter(2, 'RB', 15, 'RB'),
      starter(3, 'WR', 14, 'WR'),
      starter(4, 'RB', 12, 'FLEX'),
      player(5, 'RB', 40, { slot: 'IR' }),
      starter(6, 'LB', 8, 'LB'),
    ]);
    expect(advice.changes).toEqual([]);
    expect(advice.verdicts.get(5)).toBe('IR');
    expect(advice.verdicts.get(6)).toBe('Start');
  });
});
