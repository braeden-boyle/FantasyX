import { LineupSlot, NflGame, Player } from '../models/team.model';
import { RosterValue, optimalLineup, rosterValue } from './lineup';
import { isLocked } from './start-sit';

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
// see the rest, e.g. IDP), and not locked.
export function droppable(player: Player, startingPositions: ReadonlySet<string>, now: Date): boolean {
  return player.slot !== 'IR' && startingPositions.has(player.position) && !isLocked(player, now);
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
  return new Map(
    weeks.map((week) => {
      const players = roster.map((p) => ({
        playerId: p.playerId,
        position: p.position,
        projected: projectionFor(p, week),
        slot: null,
        locked: false,
      }));
      const starters = optimalLineup(players, slots).starters;
      const weakest = starters.some((s) => !s.player) ? 0 : Math.min(...starters.map((s) => s.player!.projected));
      return [week, weakest] as const;
    }),
  );
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

// The whole advice for a roster.
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
  const valueOf = (players: readonly WaiverPlayer[]) => rosterValue(players, slots, weeks, projectionFor);

  const active = roster.filter((p) => !p.injuredReserve);
  const openSpot = rosterSize > 0 && active.length < rosterSize;
  const before = valueOf(active);
  const weakest = weakestStarters(active, slots, weeks, projectionFor);
  const drops = active.filter((p) => p.droppable);

  // ESPN's free-agent list can lag a move, so a player already rostered is never a pickup.
  const rostered = new Set(roster.map((p) => p.playerId));
  const pool = available.filter((p) => !rostered.has(p.playerId));
  const kept = pool.filter((p) => mightHelp(p, weakest, projectionFor));
  const suggestions: WaiverSuggestion<R, A>[] = [];
  for (const player of kept) {
    // With an open spot nobody needs to go, and dropping someone never raises the value.
    const options = (openSpot ? [null] : drops)
      .map((drop) => ({ drop, value: valueOf([...active.filter((p) => p !== drop), player]) }))
      .sort((a, b) => b.value.total - a.value.total || (a.drop?.playerId ?? 0) - (b.drop?.playerId ?? 0));
    const [best, next] = options;
    if (!best) continue;
    const gain = best.value.total - before.total;
    if (gain < MIN_GAIN) continue;
    suggestions.push({
      player,
      drop: best.drop,
      gain,
      weekGain: (best.value.byWeek.get(thisWeek) ?? 0) - (before.byWeek.get(thisWeek) ?? 0),
      startsIn: weeksStarted(player, [...active.filter((p) => p !== best.drop), player], slots, weeks, projectionFor),
      alternative: next?.drop ? { drop: next.drop, gain: next.value.total - before.total } : null,
    });
  }

  suggestions.sort((a, b) => b.gain - a.gain || b.weekGain - a.weekGain || a.player.playerId - b.player.playerId);
  return { before, openSpot, suggestions, evaluated: kept.length, skipped: pool.length - kept.length };
}

// The suggestions to show: all of them, or one position's, cut to MAX_SUGGESTIONS.
export function forPosition<S extends { player: WaiverPlayer }>(suggestions: readonly S[], position: string | null): S[] {
  return suggestions.filter((s) => position === null || s.player.position === position).slice(0, MAX_SUGGESTIONS);
}

// How many weeks a player is in their roster's best lineup.
function weeksStarted(
  player: WaiverPlayer,
  roster: readonly WaiverPlayer[],
  slots: readonly LineupSlot[],
  weeks: readonly number[],
  projectionFor: (player: WaiverPlayer, week: number) => number,
): number {
  return weeks.filter((week) => {
    const players = roster.map((p) => ({
      playerId: p.playerId,
      position: p.position,
      projected: projectionFor(p, week),
      slot: null,
      locked: false,
    }));
    return optimalLineup(players, slots).starters.some((s) => s.player?.playerId === player.playerId);
  }).length;
}
