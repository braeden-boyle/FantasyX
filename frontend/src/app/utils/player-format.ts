// Display helpers shared by the roster table and the player detail drawer.

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
