import { LineupSlot, Player } from '../models/team.model';
import { Lineup, LineupPlayer, SeatedSlot, optimalLineup, slotFillOrder } from './lineup';
import { ProjectionOf, ResidualsOf, normalCdf, playerSpread } from './win-probability';

// Start/sit advice for one roster this week: the set lineup against the best one the roster can
// field (utils/lineup.ts), the changes between them, how close each call is, and the holes nobody on
// the bench can fill. See docs/PLAN.md, v1.12.

// A change whose player in outscores the player out less often than this (in percent) is a toss-up.
export const TOSS_UP_PERCENT = 55;

export type Verdict = 'Start' | 'Sit' | 'Locked' | 'Bye' | 'Out' | 'IR';

// A rostered player as the advice sees them: the optimizer's view plus the roster row and the
// player's spread (the typical miss against the active projection).
export interface AdvicePlayer extends LineupPlayer {
  player: Player;
  spread: number;
}

// One change: a player in, a player out, or both. Moves between starting slots aren't changes.
export interface LineupChange {
  in: AdvicePlayer | null;
  inSlot: string | null;
  out: AdvicePlayer | null;
  outSlot: string | null;
  // The projected points the change gains.
  gain: number;
  // The chance the player in outscores the player out, 0-1; null without both.
  chance: number | null;
  tossUp: boolean;
}

// A starter who'll likely score nothing (on bye, ruled out or projected at 0), with nobody on the
// bench who can take the slot.
export interface LineupWarning {
  slot: string;
  player: AdvicePlayer;
  reason: 'bye' | 'out' | 'zero';
}

export interface StartSitAdvice {
  current: Lineup<AdvicePlayer>;
  best: Lineup<AdvicePlayer>;
  currentTotal: number;
  bestTotal: number;
  gain: number;
  changes: LineupChange[];
  warnings: LineupWarning[];
  verdicts: Map<number, Verdict>;
  // Whether every player who could move is locked, so nothing can change.
  allLocked: boolean;
}

export interface StartSitInput {
  players: readonly Player[];
  slots: readonly LineupSlot[];
  projectionOf: ProjectionOf;
  // Each player's misses against the active source; null for position defaults.
  residualsOf: ResidualsOf | null;
  now: Date;
}

// Whether a player's game has kicked off, which locks them in place on ESPN.
export function isLocked(player: Player, now: Date): boolean {
  if (player.gameFinal || player.gameState === 'in' || player.gameState === 'post') return true;
  return !!player.gameTimeUtc && new Date(player.gameTimeUtc).getTime() <= now.getTime();
}

// The chance a outscores b, treating each score as normal around its projection with the player's
// spread: P = Phi((mu_a - mu_b) / sqrt(sigma_a^2 + sigma_b^2)).
export function chanceToOutscore(
  a: { projected: number; spread: number },
  b: { projected: number; spread: number },
): number {
  const spread = Math.sqrt(a.spread ** 2 + b.spread ** 2);
  if (spread === 0) return a.projected > b.projected ? 1 : a.projected < b.projected ? 0 : 0.5;
  return normalCdf((a.projected - b.projected) / spread);
}

// The set lineup in the same shape as the optimizer's: each starter in an entry of their slot, in
// fill order. A starter whose slot has no room left goes to the bench.
export function currentLineup<P extends LineupPlayer>(players: readonly P[], slots: readonly LineupSlot[]): Lineup<P> {
  const entries = slotFillOrder(slots);
  const seated: (P | null)[] = entries.map(() => null);
  for (const p of players.filter((p) => p.slot !== null)) {
    const i = entries.findIndex((e, i) => e.slot === p.slot && !seated[i]);
    if (i >= 0) seated[i] = p;
  }
  const starters = entries.map((slot, i) => ({ slot, player: seated[i] }));
  const started = new Set(seated.filter((p): p is P => p !== null).map((p) => p.playerId));
  return {
    starters,
    bench: players.filter((p) => !started.has(p.playerId)),
    total: starters.reduce((sum, s) => sum + (s.player?.projected ?? 0), 0),
  };
}

export interface LineupMove<P> {
  in: P | null;
  inSlot: string | null;
  out: P | null;
  outSlot: string | null;
}

// The players moving into and out of the starting lineup, paired up: each player in (best first)
// takes a player out at the same position where there is one, else one whose slot they can play,
// else any. A player in with nobody left to pair fills an empty slot; a player out with nobody left
// is simply benched.
export function lineupChanges<P extends LineupPlayer>(
  current: readonly SeatedSlot<P>[],
  best: readonly SeatedSlot<P>[],
): LineupMove<P>[] {
  const ids = (seats: readonly SeatedSlot<P>[]) => new Set(seats.flatMap((s) => (s.player ? [s.player.playerId] : [])));
  const currentIds = ids(current);
  const bestIds = ids(best);
  const ins = best
    .filter((s) => s.player && !currentIds.has(s.player.playerId))
    .sort((a, b) => b.player!.projected - a.player!.projected);
  const outs = current.filter((s) => s.player && !bestIds.has(s.player.playerId));

  const moves: LineupMove<P>[] = [];
  for (const seat of ins) {
    const p = seat.player!;
    const match =
      outs.find((o) => o.player!.position === p.position) ??
      outs.find((o) => o.slot.eligiblePositions.includes(p.position)) ??
      outs[0];
    if (match) outs.splice(outs.indexOf(match), 1);
    moves.push({ in: p, inSlot: seat.slot.slot, out: match?.player ?? null, outSlot: match?.slot.slot ?? null });
  }
  for (const seat of outs) moves.push({ in: null, inSlot: null, out: seat.player, outSlot: seat.slot.slot });
  return moves;
}

// Why a player will likely score nothing this week, if they won't.
function zeroReason(p: AdvicePlayer): LineupWarning['reason'] | null {
  if (!p.player.opponent) return 'bye';
  if (p.player.injuryStatus?.toUpperCase() === 'OUT') return 'out';
  return p.projected <= 0 ? 'zero' : null;
}

// The whole advice for a roster. Players on IR, and starters in slots the league's lineup settings
// don't cover (IDP), are left exactly where they are.
export function startSitAdvice({ players, slots, projectionOf, residualsOf, now }: StartSitInput): StartSitAdvice {
  const covered = new Set(slots.map((s) => s.slot));
  const candidates: AdvicePlayer[] = players
    .filter((p) => p.slot !== 'IR' && (!p.starter || covered.has(p.slot)))
    .map((p) => ({
      playerId: p.playerId,
      position: p.position,
      projected: projectionOf(p),
      slot: p.starter ? p.slot : null,
      locked: isLocked(p, now),
      player: p,
      spread: playerSpread(p.position, residualsOf?.(p.playerId)),
    }));

  const current = currentLineup(candidates, slots);
  const best = optimalLineup(candidates, slots);

  const changes = lineupChanges(current.starters, best.starters).map((move) => {
    const chance = move.in && move.out ? chanceToOutscore(move.in, move.out) : null;
    return {
      ...move,
      gain: (move.in?.projected ?? 0) - (move.out?.projected ?? 0),
      chance,
      tossUp: chance !== null && chance * 100 < TOSS_UP_PERCENT,
    };
  });

  const warnings = best.starters.flatMap((s) => {
    const reason = s.player && !s.player.locked && zeroReason(s.player);
    return s.player && reason ? [{ slot: s.slot.slot, player: s.player, reason }] : [];
  });

  const starting = new Set(best.starters.flatMap((s) => (s.player ? [s.player.playerId] : [])));
  const verdicts = new Map<number, Verdict>(
    players.map((p) => {
      const candidate = candidates.find((c) => c.playerId === p.playerId);
      const verdict: Verdict =
        p.slot === 'IR' ? 'IR'
        : !candidate ? (p.starter ? 'Start' : 'Sit')
        : candidate.locked ? 'Locked'
        : !p.opponent ? 'Bye'
        : p.injuryStatus?.toUpperCase() === 'OUT' ? 'Out'
        : starting.has(p.playerId) ? 'Start'
        : 'Sit';
      return [p.playerId, verdict] as const;
    }),
  );

  return {
    current,
    best,
    currentTotal: current.total,
    bestTotal: best.total,
    gain: best.total - current.total,
    changes,
    warnings,
    verdicts,
    allLocked: candidates.every((c) => c.locked),
  };
}
