import { Player } from '../models/team.model';
import { gamePhase } from './player-format';

// When the matchup view should refetch scores on its own, and how many starters are still to play.

// The most often scores are refetched, while any game is live.
export const REFRESH_INTERVAL_MS = 60 * 1000;

// Milliseconds from `now` until the next automatic refresh of scores fetched at `fetchedAt`, or null
// when no game is live or still to come. While any game is live, that's a minute after the fetch.
// Otherwise it's a minute after the next kickoff, but never sooner than a minute after the fetch, so a
// game ESPN still has as not started after its kickoff (a delay) is checked once a minute, not in a
// tight loop. 0 means a refresh is already due.
export function nextRefreshDelay(players: readonly Player[], fetchedAt: Date, now: Date): number | null {
  const earliest = fetchedAt.getTime() + REFRESH_INTERVAL_MS;
  let next: number | null = null;
  for (const player of players) {
    const phase = gamePhase(player, fetchedAt);
    const due =
      phase === 'live'
        ? earliest
        : phase === 'upcoming'
          ? Math.max(earliest, new Date(player.gameTimeUtc!).getTime() + REFRESH_INTERVAL_MS)
          : null;
    if (due !== null && (next === null || due < next)) next = due;
  }
  return next === null ? null : Math.max(0, next - now.getTime());
}

export interface PhaseCounts {
  toPlay: number;
  live: number;
  done: number;
}

// How many of the players haven't kicked off, are playing, or are done (finished, or no game).
export function phaseCounts(players: readonly Player[], now: Date): PhaseCounts {
  const counts: PhaseCounts = { toPlay: 0, live: 0, done: 0 };
  for (const player of players) {
    const phase = gamePhase(player, now);
    if (phase === 'upcoming') counts.toPlay++;
    else if (phase === 'live') counts.live++;
    else counts.done++;
  }
  return counts;
}

// "4 to play · 2 live · 3 done", leaving out groups with nobody in them.
export function formatPhaseCounts({ toPlay, live, done }: PhaseCounts): string {
  return [
    toPlay ? `${toPlay} to play` : null,
    live ? `${live} live` : null,
    done ? `${done} done` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}
