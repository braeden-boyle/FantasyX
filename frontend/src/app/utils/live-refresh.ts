import { NflGame, Player } from '../models/team.model';
import { gamePhase } from './player-format';
import { nflGamePhase } from './nfl-games';

// When the matchup view and the NFL game page should refetch scores on their own, and how many
// starters are still to play.

// The most often the matchup view refetches scores, while any game is live.
export const REFRESH_INTERVAL_MS = 60 * 1000;

// The most often the NFL game page refetches its game. Its last play goes stale faster than a
// fantasy score, and the call is for one game rather than the whole league.
export const GAME_REFRESH_INTERVAL_MS = 30 * 1000;

// Milliseconds from `now` until the next automatic refresh of scores fetched at `fetchedAt`, or null
// when no game is live or still to come. The players' games and any NFL games given count alike.
// While any game is live, that's `interval` after the fetch. Otherwise it's a minute after the next
// kickoff, but never sooner than `interval` after the fetch, so a game ESPN still has as not started
// after its kickoff (a delay) is checked every interval, not in a tight loop. 0 means a refresh is
// already due.
export function nextRefreshDelay(
  players: readonly Player[],
  fetchedAt: Date,
  now: Date,
  games: readonly NflGame[] = [],
  interval = REFRESH_INTERVAL_MS,
): number | null {
  const earliest = fetchedAt.getTime() + interval;
  const dueAt = (phase: string, kickoff: string | null) =>
    phase === 'live'
      ? earliest
      : phase === 'upcoming' && kickoff
        ? Math.max(earliest, new Date(kickoff).getTime() + REFRESH_INTERVAL_MS)
        : null;
  const due = [
    ...players.map((p) => dueAt(gamePhase(p, fetchedAt), p.gameTimeUtc)),
    ...games.map((g) => dueAt(nflGamePhase(g, fetchedAt), g.kickoffUtc)),
  ].filter((d) => d !== null);
  return due.length ? Math.max(0, Math.min(...due) - now.getTime()) : null;
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
