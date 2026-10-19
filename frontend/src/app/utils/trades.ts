import { LineupSlot } from '../models/team.model';
import { Lineup, LineupPlayer, RosterValue, optimalLineup, rosterValue, weekLineup } from './lineup';
import { RosterEntry } from './waivers';

// The trade analyzer: a trade between your team and one other, judged for both sides by roster value
// (utils/lineup.ts) after it minus before, over the weeks the trade counts in: next week through the
// last week of the fantasy playoffs. Unlike waivers, IR players count on their weekly projections
// (0 while they're out), so trading away an injured star costs their return weeks. See docs/PLAN.md,
// v1.14.

// A side's gain within this many points over the window reads as about even.
export const EVEN_MARGIN = 3;

// Up to this many drops, every combination is tried; beyond it, one drop at a time, cheapest first.
export const MAX_EXACT_DROPS = 3;

// Player ids each way: send are yours, get are the partner's.
export interface Trade {
  partnerId: number;
  send: number[];
  get: number[];
}

export type TradeOutcome = 'gains' | 'even' | 'loses';

// A player in a side's best lineup, with the roster entry behind them.
export interface TradeLineupPlayer<R extends RosterEntry> extends LineupPlayer {
  entry: R;
}

// One side of a trade. before and after are its roster value over the window; drops are the
// players it would cut to get back to the roster size. openSpots is null when the roster size isn't
// known. lineupBefore and lineupAfter are its best lineups in the trade's first week.
export interface TradeSide<R extends RosterEntry> {
  sent: R[];
  received: R[];
  before: RosterValue;
  after: RosterValue;
  gain: number;
  gainByWeek: Map<number, number>;
  drops: R[];
  openSpots: number | null;
  lineupBefore: Lineup<TradeLineupPlayer<R>>;
  lineupAfter: Lineup<TradeLineupPlayer<R>>;
  outcome: TradeOutcome;
}

export interface TradeAnalysis<R extends RosterEntry> {
  weeks: number[];
  you: TradeSide<R>;
  them: TradeSide<R>;
  label: string;
}

// weeks is the trade's window (tradeWeeks). rosterSize is how many players a roster holds outside IR
// and irSlots how many IR slots it has, both 0 when unknown.
export interface TradeInput<R extends RosterEntry> {
  mine: readonly R[];
  theirs: readonly R[];
  trade: Trade;
  slots: readonly LineupSlot[];
  weeks: readonly number[];
  rosterSize: number;
  irSlots: number;
}

// The weeks a trade counts in: the rankings' window (this week through the last week of the fantasy
// playoffs) without this week, since a trade usually sits in review and this week's lineups are
// partly locked. Empty in the last week of the playoffs.
export function tradeWeeks(fromWeek: number, toWeek: number): number[] {
  return Array.from({ length: Math.max(0, toWeek - fromWeek) }, (_, i) => fromWeek + 1 + i);
}

// A roster after the trade: the players sent removed and those received added. A received IR player
// stays on IR while the roster has an IR slot free, and otherwise comes off it into a bench spot.
export function afterTrade<R extends RosterEntry>(
  roster: readonly R[],
  sent: readonly number[],
  received: readonly R[],
  irSlots: number,
): R[] {
  const gone = new Set(sent);
  const kept = roster.filter((p) => !gone.has(p.playerId));
  let irFree = Math.max(0, irSlots - kept.filter((p) => p.injuredReserve).length);
  const incoming = received.map((p) => {
    if (!p.injuredReserve) return p;
    if (irFree > 0) {
      irFree--;
      return p;
    }
    return { ...p, injuredReserve: false };
  });
  return [...kept, ...incoming];
}

const projectionFor = (p: RosterEntry, week: number) => p.projections[week] ?? 0;

// A side's roster value over the weeks, with every player counted on their weekly projections, IR
// players included.
export function sideValue(players: readonly RosterEntry[], slots: readonly LineupSlot[], weeks: readonly number[]): RosterValue {
  return rosterValue(
    players.map((p) => ({ ...p, slot: null })),
    slots,
    weeks,
    projectionFor,
  );
}

// The drops for a side left with more players off IR than the roster size: as many as it's over,
// leaving the most roster value. Players just received are never dropped, nor anyone not droppable
// (IR, or a position no slot takes). Every combination is tried up to MAX_EXACT_DROPS; ties go to the
// drops projected for fewer points, then the lower player ids. A roster size of 0 (unknown) drops
// nobody.
export function bestDrops<R extends RosterEntry>(
  roster: readonly R[],
  received: readonly R[],
  rosterSize: number,
  slots: readonly LineupSlot[],
  weeks: readonly number[],
): R[] {
  const over = rosterSize > 0 ? roster.filter((p) => !p.injuredReserve).length - rosterSize : 0;
  if (over <= 0) return [];
  const incoming = new Set(received.map((p) => p.playerId));
  const candidates = roster.filter((p) => p.droppable && !p.injuredReserve && !incoming.has(p.playerId));
  if (candidates.length <= over) return candidates;

  if (over > MAX_EXACT_DROPS) {
    let remaining = [...roster];
    const drops: R[] = [];
    for (let i = 0; i < over; i++) {
      const [drop] = bestDropSet(remaining, candidates.filter((c) => !drops.includes(c)), 1, slots, weeks);
      drops.push(drop);
      remaining = remaining.filter((p) => p !== drop);
    }
    return drops;
  }
  return bestDropSet(roster, candidates, over, slots, weeks);
}

// The best set of `count` drops from the candidates. Dropping a player who isn't in a week's best
// lineup changes nothing that week, so only the weeks one of them starts in are solved again. And
// dropping more never raises a roster's value, so a set costs at least what its costliest member does
// alone: with the candidates cheapest first, the search stops once that alone is worse than the best
// set found.
function bestDropSet<R extends RosterEntry>(
  roster: readonly R[],
  candidates: readonly R[],
  count: number,
  slots: readonly LineupSlot[],
  weeks: readonly number[],
): R[] {
  const lineups = weeks.map((w) => weekLineup(roster, slots, w, projectionFor));
  const full = sum(lineups.map((l) => l.total));
  const valueWithout = (drops: readonly R[]) => {
    const remaining = roster.filter((p) => !drops.includes(p));
    return sum(
      weeks.map((w, i) => (drops.some((d) => lineups[i].starters.has(d.playerId)) ? weekLineup(remaining, slots, w, projectionFor) : lineups[i]).total),
    );
  };
  const points = (p: RosterEntry) => sum(weeks.map((w) => projectionFor(p, w)));
  const single = candidates
    .map((p) => ({ player: p, cost: full - valueWithout([p]), points: points(p) }))
    .sort((a, b) => a.cost - b.cost || a.points - b.points || a.player.playerId - b.player.playerId);

  // Cast, so the assignments in the closures below aren't narrowed away.
  let best = null as { drops: R[]; cost: number; points: number } | null;
  const consider = (picked: (typeof single)[number][]) => {
    const drops = picked.map((s) => s.player);
    const cost = count === 1 ? picked[0].cost : full - valueWithout(drops);
    const total = sum(picked.map((s) => s.points));
    if (!best || cost < best.cost - EPSILON || (Math.abs(cost - best.cost) <= EPSILON && beats(drops, total, best))) {
      best = { drops, cost, points: total };
    }
  };
  const search = (start: number, picked: (typeof single)[number][]) => {
    if (picked.length === count) {
      consider(picked);
      return;
    }
    for (let i = start; i <= single.length - (count - picked.length); i++) {
      if (best && single[i].cost > best.cost + EPSILON) break;
      search(i + 1, [...picked, single[i]]);
    }
  };
  search(0, []);
  return best!.drops;
}

// Whether a set of drops wins a tie in cost: fewer projected points, then the lower player ids.
function beats(drops: readonly RosterEntry[], points: number, best: { drops: readonly RosterEntry[]; points: number }): boolean {
  if (Math.abs(points - best.points) > EPSILON) return points < best.points;
  const ids = drops.map((d) => d.playerId).sort((a, b) => a - b);
  const bestIds = best.drops.map((d) => d.playerId).sort((a, b) => a - b);
  const differ = ids.findIndex((id, i) => id !== bestIds[i]);
  return differ >= 0 && ids[differ] < bestIds[differ];
}

// The players picked in a trade who are no longer on either roster (moved since the trade was set
// up), to be left out.
export function missingPicks(trade: Trade, mine: readonly RosterEntry[], theirs: readonly RosterEntry[]): number[] {
  const mineIds = new Set(mine.map((p) => p.playerId));
  const theirIds = new Set(theirs.map((p) => p.playerId));
  return [...trade.send.filter((id) => !mineIds.has(id)), ...trade.get.filter((id) => !theirIds.has(id))];
}

export function tradeOutcome(gain: number): TradeOutcome {
  if (gain > EVEN_MARGIN) return 'gains';
  if (gain < -EVEN_MARGIN) return 'loses';
  return 'even';
}

// The two outcomes in one line, yours first.
export function tradeLabel(you: TradeOutcome, them: TradeOutcome): string {
  if (you === them) return { gains: 'Good for both', even: 'About even for both', loses: 'Bad for both' }[you];
  const yours = { gains: 'You gain', even: 'About even for you', loses: 'You lose' }[you];
  const theirs = { gains: 'they gain', even: 'about even for them', loses: 'they lose' }[them];
  return `${yours}, ${theirs}`;
}

// The whole analysis, or null until both sides have a player (picks no longer on a roster left out;
// see missingPicks).
export function tradeAnalysis<R extends RosterEntry>({
  mine,
  theirs,
  trade,
  slots,
  weeks,
  rosterSize,
  irSlots,
}: TradeInput<R>): TradeAnalysis<R> | null {
  const send = new Set(trade.send);
  const get = new Set(trade.get);
  const sent = mine.filter((p) => send.has(p.playerId));
  const received = theirs.filter((p) => get.has(p.playerId));
  if (!sent.length || !received.length || !weeks.length) return null;

  const side = (roster: readonly R[], out: R[], incoming: R[]): TradeSide<R> => {
    const traded = afterTrade(roster, out.map((p) => p.playerId), incoming, irSlots);
    const incomingIds = new Set(incoming.map((p) => p.playerId));
    const drops = bestDrops(traded, traded.filter((p) => incomingIds.has(p.playerId)), rosterSize, slots, weeks);
    const final = traded.filter((p) => !drops.includes(p));
    const before = sideValue(roster, slots, weeks);
    const after = sideValue(final, slots, weeks);
    const gain = after.total - before.total;
    const offIr = final.filter((p) => !p.injuredReserve).length;
    return {
      sent: out,
      received: traded.filter((p) => incomingIds.has(p.playerId)),
      before,
      after,
      gain,
      gainByWeek: new Map(weeks.map((w) => [w, (after.byWeek.get(w) ?? 0) - (before.byWeek.get(w) ?? 0)] as const)),
      drops,
      openSpots: rosterSize > 0 ? Math.max(0, rosterSize - offIr) : null,
      lineupBefore: lineupIn(roster, slots, weeks[0]),
      lineupAfter: lineupIn(final, slots, weeks[0]),
      outcome: tradeOutcome(gain),
    };
  };

  const you = side(mine, sent, received);
  const them = side(theirs, received, sent);
  return { weeks: [...weeks], you, them, label: tradeLabel(you.outcome, them.outcome) };
}

// A side's best lineup in one week, nobody locked and no lineup set, IR players included.
function lineupIn<R extends RosterEntry>(players: readonly R[], slots: readonly LineupSlot[], week: number): Lineup<TradeLineupPlayer<R>> {
  return optimalLineup(
    players.map((p) => ({ playerId: p.playerId, position: p.position, projected: projectionFor(p, week), slot: null, locked: false, entry: p })),
    slots,
  );
}

// Rounding in the solver's sums, far below any real difference in projections.
const EPSILON = 1e-9;

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);
