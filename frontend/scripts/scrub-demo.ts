// Turns the demo capture (frontend/demo-raw/, gitignored) into the committed fixtures
// (frontend/public/demo/), with the league's team and manager names swapped for made-up ones and
// uploaded logos dropped. See docs/PLAN.md, "Demo mode". Run by hand after a capture:
//
//   npm run scrub:demo
//
// Environment: DEMO_TEAM_ID, the team a visitor starts as (default: the lowest team id), and
// ESPN_S2 and SWID, which are optional: when given, the leak check also looks for them by value.
//
// It scrubs every scenario captured, and writes nothing at all if any trace of the real league is
// left. Each scenario it writes replaces that scenario's fixtures entirely.

import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DEMO_SCENARIOS, DemoManifest } from '../src/app/models/demo.model';
import { League, TeamSummary } from '../src/app/models/team.model';
import { RawManifest } from './capture-demo-helpers';
import { buildIdentity, findLeaks, scrubValue } from './scrub-demo-helpers';

const RAW_DIR = join(__dirname, '..', 'demo-raw');
const OUT_DIR = join(__dirname, '..', 'public', 'demo');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith('.json') ? [path] : [];
  });
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} kB`;
}

function scrub(): void {
  const scenarios = DEMO_SCENARIOS.filter((s) => existsSync(join(RAW_DIR, s, 'manifest.json')));
  if (!scenarios.length) {
    throw new Error(`Nothing to scrub: capture a scenario first (npm run capture:demo -- midweek).`);
  }

  const raw = scenarios.map((scenario) => {
    const dir = join(RAW_DIR, scenario);
    return {
      scenario,
      dir,
      manifest: readJson<RawManifest>(join(dir, 'manifest.json')),
      teams: readJson<TeamSummary[]>(join(dir, 'teams.json')),
      league: readJson<League>(join(dir, 'league.json')),
    };
  });
  const leagueIds = new Set(raw.map((r) => r.manifest.leagueId));
  if (leagueIds.size > 1) {
    throw new Error('The scenarios were captured from different leagues; capture both from the same one.');
  }

  const identity = buildIdentity(raw);
  const teamIds = [...identity.teams.keys()];
  const defaultTeamId = process.env['DEMO_TEAM_ID'] ? Number(process.env['DEMO_TEAM_ID']) : Math.min(...teamIds);
  if (!teamIds.includes(defaultTeamId)) {
    throw new Error(`DEMO_TEAM_ID ${defaultTeamId} isn't a team in the league (${teamIds.join(', ')}).`);
  }

  const outputs = raw.flatMap(({ scenario, dir, manifest }) =>
    jsonFiles(dir).map((file) => {
      const path = join(scenario, relative(dir, file));
      if (path === join(scenario, 'manifest.json')) {
        const { leagueId: _, ...rest } = manifest;
        const scrubbed: DemoManifest = { ...rest, defaultTeamId };
        return { scenario, path, json: scrubbed as unknown };
      }
      return { scenario, path, json: scrubValue(readJson<unknown>(file), identity) };
    }),
  );

  const leaks = findLeaks(outputs, identity, {
    leagueId: [...leagueIds][0],
    espnS2: process.env['ESPN_S2'] || undefined,
    swid: process.env['SWID'] || undefined,
  });
  if (leaks.length) {
    for (const leak of leaks.slice(0, 50)) console.error(`${leak.path}: ${leak.what}`);
    if (leaks.length > 50) console.error(`…and ${leaks.length - 50} more.`);
    throw new Error(`${leaks.length} traces of the real league were left, so nothing was written.`);
  }

  for (const scenario of scenarios) {
    rmSync(join(OUT_DIR, scenario), { recursive: true, force: true });
    let bytes = 0;
    let gzipped = 0;
    const files = outputs.filter((o) => o.scenario === scenario);
    for (const { path, json } of files) {
      const text = JSON.stringify(json);
      const target = join(OUT_DIR, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      bytes += Buffer.byteLength(text);
      gzipped += gzipSync(text).length;
    }
    console.log(`${scenario}: ${files.length} files, ${kb(bytes)} (${kb(gzipped)} gzipped).`);
  }
  console.log(`Scrubbed fixtures written to ${OUT_DIR}. Read them over before committing.`);
}

try {
  scrub();
} catch (error) {
  console.error(`Scrub failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
