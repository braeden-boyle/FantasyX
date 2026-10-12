import { NflGame, NflGameTeam, Player } from '../models/team.model';
import { FALLBACK_FINAL_AFTER_MS, FieldState } from './player-format';

// Helpers for the week's NFL games: the strip above the matchup scoreboard and the game page.

export type NflGamePhase = 'upcoming' | 'live' | 'final';

// Where a game stands as of `now`. ESPN's scoreboard state decides, so a delayed kickoff stays
// upcoming. Kickoff time is only a fallback for a state ESPN didn't send, the same as gamePhase.
export function nflGamePhase(game: NflGame, now: Date): NflGamePhase {
  if (game.state === 'post') return 'final';
  if (game.state === 'in') return 'live';
  if (game.state === 'pre' || !game.kickoffUtc) return 'upcoming';
  const elapsed = now.getTime() - new Date(game.kickoffUtc).getTime();
  if (elapsed < 0) return 'upcoming';
  return elapsed < FALLBACK_FINAL_AFTER_MS ? 'live' : 'final';
}

// Whether a team in a live game has the ball, and whether it's inside the 20. The team itself, so
// unlike fieldState there's no D/ST flip.
export function teamFieldState(game: NflGame, team: NflGameTeam, now: Date): FieldState {
  if (nflGamePhase(game, now) !== 'live' || game.possessionTeam !== team.abbrev) return 'none';
  return game.redZone ? 'redZone' : 'ball';
}

// How many of the players play in the game, a D/ST counting for its own team.
export function playersInGame(game: NflGame, players: readonly Player[]): number {
  return players.filter((p) => p.proTeam === game.away.abbrev || p.proTeam === game.home.abbrev).length;
}

// The game the strip should open on: the first one in progress, else the next to kick off, else the
// last of the week. -1 with no games.
export function stripFocusIndex(games: readonly NflGame[], now: Date): number {
  const live = games.findIndex((g) => nflGamePhase(g, now) === 'live');
  if (live >= 0) return live;
  const upcoming = games.findIndex((g) => nflGamePhase(g, now) === 'upcoming');
  return upcoming >= 0 ? upcoming : games.length - 1;
}

// The side ahead once the game is over, for bolding the winner. Null for a tie or an unfinished game.
export function winner(game: NflGame, now: Date): NflGameTeam | null {
  const { away, home } = game;
  if (nflGamePhase(game, now) !== 'final' || away.score === null || home.score === null) return null;
  return away.score > home.score ? away : home.score > away.score ? home : null;
}

// "1st Quarter", "2nd Quarter", ..., "Overtime" (and "2nd Overtime" after that, in the playoffs).
export function periodName(period: number | null): string {
  if (!period || period < 1) return '';
  if (period <= 4) return `${ordinal(period)} Quarter`;
  return period === 5 ? 'Overtime' : `${ordinal(period - 4)} Overtime`;
}

// "Q1".."Q4", "OT", for compact labels.
export function periodShort(period: number | null): string {
  if (!period || period < 1) return '';
  return period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `${period - 4}OT`;
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
