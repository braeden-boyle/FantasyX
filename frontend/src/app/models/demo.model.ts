// The demo league's fixtures under public/demo/<scenario>/, written by scripts/capture-demo.ts and
// scripts/scrub-demo.ts. See docs/PLAN.md, "Demo mode".

export type DemoScenario = 'midweek' | 'gameday';

export const DEMO_SCENARIOS: readonly DemoScenario[] = ['midweek', 'gameday'];

// manifest.json: what a scenario holds. capturedAt is when its matchups were fetched, the moment
// the demo clock starts from; defaultTeamId is the team a visitor starts as.
export interface DemoManifest {
  scenario: DemoScenario;
  season: number;
  scoringPeriod: number;
  matchupPeriod: number;
  capturedAt: string;
  teamIds: number[];
  defaultTeamId: number;
}

// One entry of gameday/frames/index.json: when the frame's matchups were fetched, and the NFL
// games whose detail it carries (those live then, or gone final since the frame before). A game
// not in a frame is as it was in the latest frame before that has it, or else in the base capture.
export interface DemoFrame {
  frame: number;
  capturedAt: string;
  games: string[];
}
