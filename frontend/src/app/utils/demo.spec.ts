import { describe, expect, it } from 'vitest';
import { DemoFrame, DemoManifest } from '../models/demo.model';
import { AvailablePlayer, PlayerHistory, Team, WeekMatchups } from '../models/team.model';
import {
  DEMO_STEP_MS,
  demoRoute,
  msUntilNextStep,
  replayStep,
  selectAvailable,
  skipAheadStart,
  stepFrame,
  stepTimes,
} from './demo';

// Three frames: game 7 live in frames 0 and 1 and final in 1, game 8 kicking off in frame 2.
const frames: DemoFrame[] = [
  { frame: 0, capturedAt: '2026-11-01T18:00:00Z', games: ['7'] },
  { frame: 1, capturedAt: '2026-11-01T18:10:00Z', games: ['7'] },
  { frame: 2, capturedAt: '2026-11-01T18:20:00Z', games: ['8'] },
];
const manifest = { capturedAt: '2026-11-01T14:00:00Z' } as DemoManifest;

describe('demoRoute', () => {
  const route = (endpoint: string, body: Record<string, unknown> = {}, frame: number | null = null) =>
    demoRoute(endpoint, body, frame === null ? 'midweek' : 'gameday', frame, frames);

  it('answers the league-wide calls from the scenario’s files', () => {
    expect(route('leagues/teams')?.path).toBe('demo/midweek/teams.json');
    expect(route('league')?.path).toBe('demo/midweek/league.json');
    expect(route('draft')?.path).toBe('demo/midweek/draft.json');
    expect(route('matchups')?.path).toBe('demo/midweek/matchups.json');
    expect(route('matchups', {}, 1)?.path).toBe('demo/gameday/frames/1/matchups.json');
  });

  it('answers a team from its file, or on game day from the frame’s matchups', () => {
    expect(route('team', { teamId: 3 })).toEqual({ path: 'demo/midweek/team/3.json' });
    const fromFrame = route('team', { teamId: 3 }, 2)!;
    expect(fromFrame.path).toBe('demo/gameday/frames/2/matchups.json');
    const team = { teamId: 3, name: 'Blitz Brigade' } as Team;
    const week = { teams: [{ team: { teamId: 1 } }, { team }] } as WeekMatchups;
    expect(fromFrame.select!(week)).toBe(team);
  });

  it('answers a game from the latest frame that has it, else the morning capture', () => {
    expect(route('nfl-game', { eventId: '7' })?.path).toBe('demo/midweek/nfl-game/7.json');
    expect(route('nfl-game', { eventId: '7' }, 0)?.path).toBe('demo/gameday/frames/0/nfl-game/7.json');
    expect(route('nfl-game', { eventId: '7' }, 2)?.path).toBe('demo/gameday/frames/1/nfl-game/7.json');
    expect(route('nfl-game', { eventId: '8' }, 1)?.path).toBe('demo/gameday/nfl-game/8.json');
  });

  it('cuts the history down to the players asked for', () => {
    const r = route('player-history', { playerIds: [2, 3] })!;
    const all = [1, 2, 3].map((playerId) => ({ playerId }) as PlayerHistory);
    expect((r.select!(all) as PlayerHistory[]).map((h) => h.playerId)).toEqual([2, 3]);
  });

  it('refuses ids that aren’t numbers, and endpoints the demo doesn’t have', () => {
    expect(route('player', { playerId: 12 })?.path).toBe('demo/midweek/player/12.json');
    expect(route('player', { playerId: '../league' })).toBeNull();
    expect(route('team', {})).toBeNull();
    expect(route('nfl-game', { eventId: '7/../../x' })).toBeNull();
    expect(route('logo', { url: 'https://example.com' })).toBeNull();
  });
});

describe('selectAvailable', () => {
  it('takes up to perPosition at each position asked for, in the order captured', () => {
    const all = ['QB', 'RB', 'QB', 'K', 'QB'].map((position, i) => ({ playerId: i, position }) as AvailablePlayer);
    expect(selectAvailable(all, ['QB', 'RB'], 2).map((p) => p.playerId)).toEqual([0, 2, 1]);
  });
});

describe('the game-day replay', () => {
  const times = stepTimes(manifest, frames);
  const start = 1_000_000;

  it('starts at the morning capture, then shows each frame for one step', () => {
    expect(times).toHaveLength(4);
    expect(replayStep(4, start, start)).toBe(0);
    expect(stepFrame(replayStep(4, start, start))).toBeNull();
    expect(stepFrame(replayStep(4, start, start + DEMO_STEP_MS))).toBe(0);
    expect(stepFrame(replayStep(4, start, start + 3 * DEMO_STEP_MS - 1))).toBe(1);
  });

  it('stays on the last step once it’s over', () => {
    expect(replayStep(4, start, start + 100 * DEMO_STEP_MS)).toBe(3);
    expect(msUntilNextStep(4, start, start + 100 * DEMO_STEP_MS)).toBeNull();
  });

  it('counts down to the next step', () => {
    expect(msUntilNextStep(4, start, start + 1000)).toBe(DEMO_STEP_MS - 1000);
  });

  it('skips ahead by game time, never back, and stops at the end', () => {
    // From the morning capture, 30 minutes is the first frame (four hours on).
    const s1 = skipAheadStart(times, start, start, 30);
    expect(replayStep(4, s1, start)).toBe(1);
    // From frame 0, 15 minutes passes frame 1 (10 minutes) to frame 2 (20 minutes).
    const s2 = skipAheadStart(times, s1, start, 15);
    expect(replayStep(4, s2, start)).toBe(3);
    // Nothing further: it stays on the last step.
    expect(replayStep(4, skipAheadStart(times, s2, start, 30), start)).toBe(3);
  });
});
