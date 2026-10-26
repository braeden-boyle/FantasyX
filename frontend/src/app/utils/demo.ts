import { DemoFrame, DemoManifest, DemoScenario } from '../models/demo.model';
import { AvailablePlayer, PlayerHistory, WeekMatchups } from '../models/team.model';
import { REFRESH_INTERVAL_MS } from './live-refresh';

// The demo league's plumbing: which fixture answers each backend call, and the game-day replay's
// steps. See docs/PLAN.md, "Demo mode".

// The demo league's id in every request. ESPN league ids start at 1, so a request for league 0 can
// only be the demo's, and only those are answered from the fixtures.
export const DEMO_LEAGUE_ID = 0;

// How long each step of the game-day replay lasts, in real time. The same as the matchup view's
// live refresh, so each refresh lands on the next step.
export const DEMO_STEP_MS = REFRESH_INTERVAL_MS;

// A fixture file under the app's base path, and how to cut the answer from it when it holds more
// than was asked for.
export interface DemoRoute {
  path: string;
  select?: (json: unknown) => unknown;
}

// Where the game-day replay is: null on the first step (the Sunday-morning capture), else the
// index of the frame shown. Mid-week is always null.
export type DemoFrameIndex = number | null;

const ID = /^\d+$/;

// The fixture that answers a demo request to /api/espn/<endpoint>, or null for one the demo doesn't
// have (an unknown endpoint, or an id that isn't one). On game day, the current frame's matchups
// are the week, and each team is as it is in them.
export function demoRoute(
  endpoint: string,
  body: Record<string, unknown>,
  scenario: DemoScenario,
  frame: DemoFrameIndex,
  frames: readonly DemoFrame[],
): DemoRoute | null {
  const base = `demo/${scenario}`;
  const matchups = frame === null ? `${base}/matchups.json` : `${base}/frames/${frames[frame].frame}/matchups.json`;
  const id = (key: string) => {
    const value = String(body[key] ?? '');
    return ID.test(value) ? value : null;
  };

  switch (endpoint) {
    case 'leagues/teams':
      return { path: `${base}/teams.json` };
    case 'league':
      return { path: `${base}/league.json` };
    case 'draft':
      return { path: `${base}/draft.json` };
    case 'matchups':
      return { path: matchups };
    case 'team': {
      const teamId = id('teamId');
      if (teamId === null) return null;
      if (frame === null) return { path: `${base}/team/${teamId}.json` };
      return {
        path: matchups,
        select: (week) => (week as WeekMatchups).teams.find((t) => t.team.teamId === Number(teamId))?.team ?? null,
      };
    }
    case 'player': {
      const playerId = id('playerId');
      return playerId === null ? null : { path: `${base}/player/${playerId}.json` };
    }
    case 'player-history': {
      const wanted = new Set((body['playerIds'] as number[] | undefined) ?? []);
      return {
        path: `${base}/history.json`,
        select: (all) => (all as PlayerHistory[]).filter((h) => wanted.has(h.playerId)),
      };
    }
    case 'available-players': {
      const positions = (body['positions'] as string[] | undefined) ?? [];
      const perPosition = Number(body['perPosition'] ?? 0);
      return { path: `${base}/available.json`, select: (all) => selectAvailable(all as AvailablePlayer[], positions, perPosition) };
    }
    case 'nfl-game': {
      const eventId = id('eventId');
      if (eventId === null) return null;
      const from = frame === null ? undefined : frames.slice(0, frame + 1).reverse().find((f) => f.games.includes(eventId));
      return { path: from ? `${base}/frames/${from.frame}/nfl-game/${eventId}.json` : `${base}/nfl-game/${eventId}.json` };
    }
    default:
      return null;
  }
}

// The available players at each position asked for, up to perPosition each, in the order captured.
export function selectAvailable(all: readonly AvailablePlayer[], positions: readonly string[], perPosition: number): AvailablePlayer[] {
  return positions.flatMap((position) => all.filter((p) => p.position === position).slice(0, perPosition));
}

// The game-day replay's steps, as clock times: the Sunday-morning capture, then each frame.
export function stepTimes(manifest: DemoManifest, frames: readonly DemoFrame[]): number[] {
  return [Date.parse(manifest.capturedAt), ...frames.map((f) => Date.parse(f.capturedAt))];
}

// The step shown `now`, for a replay started at startedAt (both real time). It stays on the last
// step once the replay is over.
export function replayStep(stepCount: number, startedAt: number, now: number): number {
  return Math.min(Math.max(0, Math.floor((now - startedAt) / DEMO_STEP_MS)), stepCount - 1);
}

// The frame a step shows: none on the first step, which is the Sunday-morning capture.
export function stepFrame(step: number): DemoFrameIndex {
  return step === 0 ? null : step - 1;
}

// Real milliseconds until the replay's next step, or null on the last one.
export function msUntilNextStep(stepCount: number, startedAt: number, now: number): number | null {
  const step = replayStep(stepCount, startedAt, now);
  return step >= stepCount - 1 ? null : startedAt + (step + 1) * DEMO_STEP_MS - now;
}

// The replay start that moves it on by `minutes` of game time: to the first step at least that far
// past the current one's time, or the last step. It never moves back.
export function skipAheadStart(times: readonly number[], startedAt: number, now: number, minutes: number): number {
  const step = replayStep(times.length, startedAt, now);
  const target = times[step] + minutes * 60 * 1000;
  const index = times.findIndex((t, i) => i > step && t >= target);
  const next = index === -1 ? times.length - 1 : index;
  return now - next * DEMO_STEP_MS;
}
