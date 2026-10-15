import { LineupSlot, NflGame, Player } from '../models/team.model';
import { RosterValue, optimalLineup } from './lineup';

// Waiver advice for one roster: the free agents and waiver players worth claiming, each with the drop
// that leaves the roster strongest. A move is valued as the roster's value (utils/lineup.ts) after it
// minus before, over the rest of the season; this week's share is shown beside it. See docs/PLAN.md,
// v1.13.

// The smallest rest-of-season gain worth suggesting, so rounding noise isn't a pickup.
export const MIN_GAIN = 0.5;

// How many pickups are shown, overall or at one position.
export const MAX_SUGGESTIONS = 25;

// A player as waiver advice sees them, rostered or available: the active source's projection for
// each week of the window (a week missing counts 0).
export interface WaiverPlayer {
  playerId: number;
  position: string;
  projections: Readonly<Record<number, number>>;
}

// A rostered player. IR players don't take a roster spot and don't count toward roster value.
export interface RosterEntry extends WaiverPlayer {
  injuredReserve: boolean;
  droppable: boolean;
}

// A free agent or waiver player. A locked one's game has kicked off, so they can't score this week.
export interface AvailableEntry extends WaiverPlayer {
  locked: boolean;
}

// weeks is the window, this week first. rosterSize is how many players a roster holds outside IR
// (0 when unknown, which reads as full).
export interface WaiverInput<R extends RosterEntry, A extends AvailableEntry> {
  roster: readonly R[];
  available: readonly A[];
  slots: readonly LineupSlot[];
  weeks: readonly number[];
  rosterSize: number;
}

// One pickup: the player to add, the drop (null with an open spot), the rest-of-season and this
// week's gains, and how many weeks of the window the pickup starts in. alternative is the next-best
// drop, null with an open spot or nobody else to drop.
export interface WaiverSuggestion<R extends RosterEntry, A extends AvailableEntry> {
  player: A;
  drop: R | null;
  gain: number;
  weekGain: number;
  startsIn: number;
  alternative: { drop: R; gain: number } | null;
}

// suggestions are every pickup gaining at least MIN_GAIN, best first (see forPosition for the cut).
// evaluated and skipped count the available players the prefilter kept and left out.
export interface WaiverAdvice<R extends RosterEntry, A extends AvailableEntry> {
  before: RosterValue;
  openSpot: boolean;
  suggestions: WaiverSuggestion<R, A>[];
  evaluated: number;
  skipped: number;
}

// Whether a rostered player can be dropped now: not on IR (it frees no bench spot, and roster value
// leaves them out, so they'd look free), at a position a starting slot takes (roster value can't
// see the rest, e.g. IDP), and not locked (start/sit's isLocked).
export function droppable(
  player: Pick<Player, 'slot' | 'position'>,
  startingPositions: ReadonlySet<string>,
  locked: boolean,
): boolean {
  return player.slot !== 'IR' && startingPositions.has(player.position) && !locked;
}

// Whether a pro team's game this week has kicked off, from the week's NFL games. False on a bye, or
// when the scoreboard couldn't be read.
export function proTeamLocked(proTeam: string, games: readonly NflGame[], now: Date): boolean {
  const game = games.find((g) => g.home.abbrev === proTeam || g.away.abbrev === proTeam);
  if (!game) return false;
  return game.state !== 'pre' || (!!game.kickoffUtc && new Date(game.kickoffUtc).getTime() <= now.getTime());
}

// For each week, the lowest projection in the roster's best lineup, or 0 when a slot is left empty.
// A pickup can only raise a week's best lineup by bumping its weakest starter to the bench (through a
// chain of moves if need be) or by filling an empty slot.
export function weakestStarters(
  roster: readonly WaiverPlayer[],
  slots: readonly LineupSlot[],
  weeks: readonly number[],
  projectionFor: (player: WaiverPlayer, week: number) => number,
): Map<number, number> {
  return new Map(weeks.map((week) => [week, weekLineup(roster, slots, week, projectionFor).weakest] as const));
}

// The prefilter: whether a pickup out-projects the weakest starter in some week. A drop only lowers
// a roster's value, so a player who fails this has no positive gain with any drop. Comparing with
// the starters at their own position only would not be safe: with RB/WR and WR/TE slots, an RB can
// gain by pushing a WR into WR/TE.
export function mightHelp(
  candidate: WaiverPlayer,
  weakest: ReadonlyMap<number, number>,
  projectionFor: (player: WaiverPlayer, week: number) => number,
): boolean {
  return [...weakest].some(([week, level]) => projectionFor(candidate, week) > level);
}

// The whole advice for a roster. Each pickup's best drop is found without trying every one, using
// two facts about best-lineup values:
//   - a drop never raises the value, so no pickup gains more than it would with an open spot (its
//     ceiling);
//   - adding a player raises a week's best lineup by at most their projection, so a pickup gains at
//     most its own projected points minus what the drop costs the roster today.
// Drops are tried cheapest first, and the search stops once neither bound lets a later one beat the
// top two. Dropping a player who isn't in a week's best lineup changes nothing that week, so only the
// weeks they start in are solved again.
export function waiverAdvice<R extends RosterEntry, A extends AvailableEntry>({
  roster,
  available,
  slots,
  weeks,
  rosterSize,
}: WaiverInput<R, A>): WaiverAdvice<R, A> {
  const thisWeek = weeks[0];
  // A locked pickup's game this week has kicked off, so they count from next week.
  const locked = new Set(available.filter((p) => p.locked).map((p) => p.playerId));
  const projectionFor = (p: WaiverPlayer, week: number) =>
    week === thisWeek && locked.has(p.playerId) ? 0 : (p.projections[week] ?? 0);
  const lineupsOf = (players: readonly WaiverPlayer[]) => weeks.map((w) => weekLineup(players, slots, w, projectionFor));

  const active = roster.filter((p) => !p.injuredReserve);
  const openSpot = rosterSize > 0 && active.length < rosterSize;
  const beforeLineups = lineupsOf(active);
  const before: RosterValue = {
    byWeek: new Map(weeks.map((w, i) => [w, beforeLineups[i].total] as const)),
    total: sum(beforeLineups.map((l) => l.total)),
  };
  // The prefilter's levels, from the lineups already solved (weakestStarters, without solving again).
  const weakest = new Map(weeks.map((w, i) => [w, beforeLineups[i].weakest] as const));

  // What dropping each player costs the roster as it is, cheapest first; equal costs drop whoever
  // is projected for less.
  const drops = openSpot
    ? []
    : active
        .filter((p) => p.droppable)
        .map((p) => ({
          player: p,
          cost: before.total - sum(lineupsOf(active.filter((q) => q !== p)).map((l) => l.total)),
          points: sum(weeks.map((w) => projectionFor(p, w))),
        }))
        .sort((a, b) => a.cost - b.cost || a.points - b.points || a.player.playerId - b.player.playerId);

  // ESPN's free-agent list can lag a move, so a player already rostered is never a pickup.
  const rostered = new Set(roster.map((p) => p.playerId));
  const pool = available.filter((p) => !rostered.has(p.playerId));
  const kept = pool.filter((p) => mightHelp(p, weakest, projectionFor));
  const suggestions: WaiverSuggestion<R, A>[] = [];
  for (const player of kept) {
    const added = [...active, player];
    const withPickup = lineupsOf(added);
    const ceiling = sum(withPickup.map((l) => l.total)) - before.total;
    if (ceiling < MIN_GAIN) continue;
    if (openSpot) {
      suggestions.push({
        player,
        drop: null,
        gain: ceiling,
        weekGain: withPickup[0].total - beforeLineups[0].total,
        startsIn: withPickup.filter((l) => l.starters.has(player.playerId)).length,
        alternative: null,
      });
      continue;
    }

    const projected = sum(weeks.map((w) => projectionFor(player, w)));
    let best: DropResult<R> | null = null;
    let next: DropResult<R> | null = null;
    for (const { player: drop, cost } of drops) {
      // Drops come cheapest first, so this bound only falls; ties go to the earlier drop.
      if (next && Math.min(ceiling, projected - cost) <= next.gain + EPSILON) break;
      const result = dropResult(drop, player, added, withPickup, weeks, slots, projectionFor, before);
      if (!best || result.gain > best.gain + EPSILON) [best, next] = [result, best];
      else if (!next || result.gain > next.gain + EPSILON) next = result;
    }
    if (!best || best.gain < MIN_GAIN) continue;
    suggestions.push({
      player,
      drop: best.drop,
      gain: best.gain,
      weekGain: best.weekGain,
      startsIn: best.startsIn,
      alternative: next ? { drop: next.drop, gain: next.gain } : null,
    });
  }

  suggestions.sort((a, b) => b.gain - a.gain || b.weekGain - a.weekGain || a.player.playerId - b.player.playerId);
  return { before, openSpot, suggestions, evaluated: kept.length, skipped: pool.length - kept.length };
}

// Rounding in the solver's sums, far below any real difference in projections.
const EPSILON = 1e-9;

// One week's best lineup: its total, who starts, and its weakest starter (0 with a slot left empty).
interface WeekLineup {
  total: number;
  starters: Set<number>;
  weakest: number;
}

function weekLineup(
  players: readonly WaiverPlayer[],
  slots: readonly LineupSlot[],
  week: number,
  projectionFor: (player: WaiverPlayer, week: number) => number,
): WeekLineup {
  const lineup = optimalLineup(
    players.map((p) => ({ playerId: p.playerId, position: p.position, projected: projectionFor(p, week), slot: null, locked: false })),
    slots,
  );
  const seated = lineup.starters.flatMap((s) => (s.player ? [s.player] : []));
  return {
    total: lineup.total,
    starters: new Set(seated.map((p) => p.playerId)),
    weakest: seated.length < lineup.starters.length ? 0 : Math.min(...seated.map((p) => p.projected)),
  };
}

interface DropResult<R> {
  drop: R;
  gain: number;
  weekGain: number;
  startsIn: number;
}

// A pickup with one drop: the roster value gained, this week's share, and how many weeks the pickup
// starts in. withPickup is the best lineup each week with the pickup added and nobody dropped.
function dropResult<R extends WaiverPlayer>(
  drop: R,
  pickup: WaiverPlayer,
  added: readonly WaiverPlayer[],
  withPickup: readonly WeekLineup[],
  weeks: readonly number[],
  slots: readonly LineupSlot[],
  projectionFor: (player: WaiverPlayer, week: number) => number,
  before: RosterValue,
): DropResult<R> {
  const remaining = added.filter((p) => p !== drop);
  const after = weeks.map((w, i) =>
    withPickup[i].starters.has(drop.playerId) ? weekLineup(remaining, slots, w, projectionFor) : withPickup[i],
  );
  return {
    drop,
    gain: sum(after.map((l) => l.total)) - before.total,
    weekGain: after[0].total - (before.byWeek.get(weeks[0]) ?? 0),
    startsIn: after.filter((l) => l.starters.has(pickup.playerId)).length,
  };
}

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);

// The suggestions to show: all of them, or one position's, cut to MAX_SUGGESTIONS.
export function forPosition<S extends { player: WaiverPlayer }>(suggestions: readonly S[], position: string | null): S[] {
  return suggestions.filter((s) => position === null || s.player.position === position).slice(0, MAX_SUGGESTIONS);
}
