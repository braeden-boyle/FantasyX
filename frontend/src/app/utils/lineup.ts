import { LineupSlot } from '../models/team.model';

// The best starting lineup a roster can field, and a roster's value over the rest of the season:
// the base the start/sit assistant, waiver suggestions and the trade analyzer share. Pure, so the
// capture script and tests can use it without Angular.

// A tiny bonus for keeping a player in the slot they're already in, so a tie never reads as a
// change. Far below any real difference in projections.
export const KEEP_EPSILON = 1e-6;

// The cost of an assignment the solver must never make (an ineligible player in a slot). Finite,
// so the arithmetic stays exact.
const FORBIDDEN = 1e9;

export interface LineupCandidate {
  playerId: number;
  position: string;
  projected: number;
}

// A player as the optimizer sees them: slot is the starting slot they're in now (a LineupSlot's
// name), or null on the bench. A locked player (their game has kicked off) can't be moved.
export interface LineupPlayer extends LineupCandidate {
  slot: string | null;
  locked: boolean;
}

// One starter's place in a lineup: the slot, and who fills it (null when nobody can).
export interface SeatedSlot<P extends LineupCandidate = LineupPlayer> {
  slot: LineupSlot;
  player: P | null;
}

export interface Lineup<P extends LineupCandidate = LineupPlayer> {
  starters: SeatedSlot<P>[];
  bench: P[];
  total: number;
}

// A lineup's slots in the order they're filled, one entry per starter: the most restrictive (fewest
// eligible positions) first, so a FLEX comes after RB, WR and TE. Shared with player rankings'
// league-wide starter count.
export function slotFillOrder(slots: readonly LineupSlot[]): LineupSlot[] {
  return [...slots]
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length)
    .flatMap((slot) => Array.from({ length: slot.count }, () => slot));
}

// The best lineup a set of players can field: the most projected points, with every slot taken by
// a player whose position it accepts. Locked players stay where they are (a locked starter in their
// slot, a locked bench player on the bench); everyone else is placed by an exact assignment, since
// filling the most restrictive slot first is only optimal when slots nest (it fails with RB/WR and
// WR/TE slots, say). A player projected at 0 or below is only started if they're already in that
// slot, so a bye isn't swapped for another bye. Pass only players who could fill these slots:
// leave out IR and starters in slots outside them (IDP).
export function optimalLineup<P extends LineupPlayer>(players: readonly P[], slots: readonly LineupSlot[]): Lineup<P> {
  const entries = slotFillOrder(slots);
  const seated: (P | null)[] = entries.map(() => null);

  // Locked starters keep their slot, as far as the slot has room.
  for (const p of players.filter((p) => p.locked && p.slot !== null)) {
    const i = entries.findIndex((e, i) => e.slot === p.slot && !seated[i]);
    if (i >= 0) seated[i] = p;
  }

  const open = entries.map((_, i) => i).filter((i) => !seated[i]);
  const movable = players
    .filter((p) => !p.locked)
    .sort((a, b) => b.projected - a.projected || a.playerId - b.playerId);

  if (open.length && movable.length) {
    // Rows are open slots; columns are the movable players, then one "leave it empty" column per
    // slot at no cost. Costs are negated weights, since the solver minimises.
    const cost = open.map((i, row) => {
      const slot = entries[i];
      const playerCosts = movable.map((p) => {
        const current = p.slot === slot.slot;
        if (!slot.eligiblePositions.includes(p.position) || (p.projected <= 0 && !current)) return FORBIDDEN;
        return -(p.projected + (current ? KEEP_EPSILON : 0));
      });
      const empty = open.map((_, r) => (r === row ? 0 : FORBIDDEN));
      return [...playerCosts, ...empty];
    });
    assignRows(cost).forEach((column, row) => {
      if (column < movable.length) seated[open[row]] = movable[column];
    });
  }

  const starters = entries.map((slot, i) => ({ slot, player: seated[i] }));
  const started = new Set(seated.filter((p): p is P => p !== null).map((p) => p.playerId));
  const bench = players.filter((p) => !started.has(p.playerId));
  const total = starters.reduce((sum, s) => sum + (s.player?.projected ?? 0), 0);
  return { starters, bench, total };
}

// The projected total of the best starting lineup a set of players can field, with no lineup set
// and nobody locked. Used for draft day, and for later weeks, when lineups get reset.
export function bestLineupTotal(players: readonly LineupCandidate[], slots: readonly LineupSlot[]): number {
  return optimalLineup(
    players.map((p) => ({ ...p, slot: null, locked: false })),
    slots,
  ).total;
}

export interface RosterValue {
  byWeek: Map<number, number>;
  total: number;
}

// A roster's value over a run of weeks: the best lineup it can field each week (IR left out), and
// their sum. A player's bye, or a week they're ruled out, costs only that week. A pickup, drop or
// trade is valued as the roster's value after it minus before.
export function rosterValue<P extends { playerId: number; position: string; slot?: string | null }>(
  players: readonly P[],
  slots: readonly LineupSlot[],
  weeks: readonly number[],
  projectionFor: (player: P, week: number) => number,
): RosterValue {
  const eligible = players.filter((p) => p.slot !== 'IR');
  const byWeek = new Map(
    weeks.map((week) => {
      const candidates = eligible.map((p) => ({ playerId: p.playerId, position: p.position, projected: projectionFor(p, week) }));
      return [week, bestLineupTotal(candidates, slots)] as const;
    }),
  );
  return { byWeek, total: [...byWeek.values()].reduce((sum, v) => sum + v, 0) };
}

// The Hungarian algorithm (Kuhn-Munkres): the column assigned to each row that minimises the total
// cost, for a matrix with no more rows than columns. O(rows^2 x columns), which is nothing at
// lineup sizes.
function assignRows(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const m = cost[0].length;
  // 1-based potentials and matches, with index 0 as the free starting point.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const rowOf = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    rowOf[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = rowOf[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const reduced = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (reduced < minv[j]) {
          minv[j] = reduced;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[rowOf[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (rowOf[j0] !== 0);
    do {
      const j1 = way[j0];
      rowOf[j0] = rowOf[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const columns = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (rowOf[j]) columns[rowOf[j] - 1] = j - 1;
  return columns;
}
