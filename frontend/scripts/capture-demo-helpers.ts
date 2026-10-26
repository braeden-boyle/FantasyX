import { DEMO_SCENARIOS, DemoManifest, DemoScenario } from '../src/app/models/demo.model';
import { AvailablePlayer, NflGame, WeekMatchups } from '../src/app/models/team.model';

// The demo capture script's pure parts, kept apart from it so Vitest can import them without
// running a capture. See docs/PLAN.md, "Demo mode".

// The raw capture's manifest: the league id instead of the team a visitor starts as, which the
// scrub picks. The league id is only ever in the raw capture.
export type RawManifest = Omit<DemoManifest, 'defaultTeamId'> & { leagueId: number };

// How long after the first game of the day still counts as that day. Covers 1:00 PM ET to the
// Sunday night game (about 7.5 hours) with room to spare, but not Monday night (about 31 hours).
export const GAME_DAY_HOURS = 18;

// A game ESPN still has as not started this long after its kickoff (postponed, or a scoreboard
// gap) no longer holds the capture open.
export const STALLED_GAME_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

export function parseScenario(value: string | undefined): DemoScenario {
  if (!DEMO_SCENARIOS.includes(value as DemoScenario)) {
    throw new Error(`Name the scenario to capture: ${DEMO_SCENARIOS.join(' or ')}.`);
  }
  return value as DemoScenario;
}

// Every player on a roster this week, benches and IR included, as the app's history request has.
export function rosteredPlayerIds(week: WeekMatchups): number[] {
  return [...new Set(week.teams.flatMap((t) => t.team.players.map((p) => p.playerId)))];
}

// The players the demo can open a detail for: everyone rostered, plus the available players the
// rankings and waivers list. Anyone else's drawer shows as unavailable.
export function detailPlayerIds(week: WeekMatchups, available: readonly AvailablePlayer[]): number[] {
  return [...new Set([...rosteredPlayerIds(week), ...available.map((p) => p.playerId)])];
}

// The games of the day being captured: those kicking off within GAME_DAY_HOURS of the earliest game
// not yet final, in kickoff order. Empty when every game is final or none has a kickoff time.
export function gameDayIds(games: readonly NflGame[]): string[] {
  const pending = games.filter((g) => g.state !== 'post' && g.kickoffUtc);
  if (!pending.length) return [];
  const first = Math.min(...pending.map((g) => Date.parse(g.kickoffUtc!)));
  return pending
    .filter((g) => Date.parse(g.kickoffUtc!) < first + GAME_DAY_HOURS * HOUR_MS)
    .sort((a, b) => Date.parse(a.kickoffUtc!) - Date.parse(b.kickoffUtc!))
    .map((g) => g.eventId);
}

// The first kickoff among the day's games, or null without one.
export function firstKickoff(games: readonly NflGame[], dayIds: readonly string[]): Date | null {
  const kickoffs = games.filter((g) => dayIds.includes(g.eventId) && g.kickoffUtc).map((g) => Date.parse(g.kickoffUtc!));
  return kickoffs.length ? new Date(Math.min(...kickoffs)) : null;
}

// The games whose detail a frame saves: those live now, and those gone final since the last frame
// (previous maps each game to its state then; a game missing from it was last seen not final).
export function frameGameIds(games: readonly NflGame[], previous: ReadonlyMap<string, NflGame['state']>): string[] {
  return games
    .filter((g) => g.state === 'in' || (g.state === 'post' && previous.get(g.eventId) !== 'post'))
    .map((g) => g.eventId);
}

// Whether the day's games are all done: final, or stalled (still not started STALLED_GAME_HOURS
// after kickoff). A game missing from the scoreboard counts as done, since it can't be captured.
export function gameDayOver(games: readonly NflGame[], dayIds: readonly string[], now: Date): boolean {
  return dayIds.every((id) => {
    const game = games.find((g) => g.eventId === id);
    if (!game || game.state === 'post') return true;
    return game.state === 'pre' && !!game.kickoffUtc && now.getTime() > Date.parse(game.kickoffUtc) + STALLED_GAME_HOURS * HOUR_MS;
  });
}
