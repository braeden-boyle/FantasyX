import { Player } from '../models/team.model';

// Display helpers shared by the roster table, the matchup view and the player detail drawer.

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
