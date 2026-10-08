import { Player } from '../models/team.model';
import { GAME_LENGTH_MS } from './win-probability';

// Display helpers shared by the roster table, the matchup view and the player detail drawer.

export type GamePhase = 'none' | 'upcoming' | 'live' | 'final';

// Without ESPN's scoreboard, a game is guessed final this long after kickoff (allowing for overtime
// and delays), rather than reading live until its stats are made official.
export const FALLBACK_FINAL_AFTER_MS = GAME_LENGTH_MS + 60 * 60 * 1000;

// Where the player's game this week stands as of `now`: no game (a bye), not started, in progress or
// over. Follows ESPN's scoreboard when the matchup data has it, and the kickoff time otherwise.
export function gamePhase(player: Player, now: Date): GamePhase {
  if (!player.opponent || !player.gameTimeUtc) return 'none';
  if (player.gameFinal || player.gameState === 'post') return 'final';
  if (player.gameState === 'in') return 'live';
  if (player.gameState === 'pre') return 'upcoming';
  const elapsed = now.getTime() - new Date(player.gameTimeUtc).getTime();
  if (elapsed < 0) return 'upcoming';
  return elapsed < FALLBACK_FINAL_AFTER_MS ? 'live' : 'final';
}

export type FieldState = 'none' | 'ball' | 'redZone';

// Whether the player's side of a live game has the ball: their own team for every position (kickers
// included), or the opponent for a D/ST, which is on the field when the other team has it. 'redZone'
// when that's inside the 20. It follows team possession, not whether this player is on the field.
export function fieldState(player: Player, now: Date): FieldState {
  if (gamePhase(player, now) !== 'live' || !player.possessionTeam) return 'none';
  const side = player.position === 'D/ST' ? player.opponent : player.proTeam;
  if (player.possessionTeam !== side) return 'none';
  return player.redZone ? 'redZone' : 'ball';
}

const STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];

// A roster's starters in standard lineup order (QB, RB, WR, TE, FLEX, D/ST, K).
export function sortStarters(players: Player[]): Player[] {
  return players
    .filter((p) => p.starter)
    .sort((a, b) => STARTER_SLOT_ORDER.indexOf(a.slot) - STARTER_SLOT_ORDER.indexOf(b.slot));
}

export function statusSeverity(status: string | null): 'success' | 'warn' | 'danger' {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':
      return 'success';
    case 'QUESTIONABLE':
      return 'warn';
    default:
      return 'danger';
  }
}

// ESPN's injury statuses abbreviated the way ESPN's own lineups show them, for tight spaces.
const STATUS_ABBREVIATIONS: Record<string, string> = {
  QUESTIONABLE: 'Q',
  DOUBTFUL: 'D',
  OUT: 'O',
  PROBABLE: 'P',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'SSPD',
  DAY_TO_DAY: 'DTD',
};

// Unknown statuses fall back to the initials of their words (e.g. "PHYSICALLY_UNABLE" -> "PU").
export function shortStatus(status: string): string {
  const key = status.toUpperCase();
  return STATUS_ABBREVIATIONS[key] ?? key.split(/[_\s]+/).map((word) => word[0]).join('');
}

// "INJURY_RESERVE" -> "Injury Reserve", for tooltips beside an abbreviated status.
export function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatGameTime(gameTimeUtc: string | null): string | null {
  if (!gameTimeUtc) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(gameTimeUtc));
}

// Like formatGameTime but with the date, for schedules that span more than the current week.
export function formatGameDate(gameTimeUtc: string | null): string | null {
  if (!gameTimeUtc) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(gameTimeUtc));
}

// ESPN's "rank vs position" is 1 (toughest matchup for that position) to 32 (easiest); scaled
// down to a 1-5 star rating where 1 star is a hard matchup and 5 stars is an easy one.
export function matchupStars(rank: number | null): number {
  if (rank === null) return 0;
  return Math.min(5, Math.max(1, Math.ceil((rank / 32) * 5)));
}

// A points difference to one decimal with its sign: "+41.2", or "−3.5" with a real minus sign.
export function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded < 0 ? '−' : '+'}${Math.abs(rounded).toFixed(1)}`;
}
