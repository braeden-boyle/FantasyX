// Records one league's backend responses for the demo (docs/PLAN.md, "Demo mode"), run by hand
// against a local backend:
//
//   npm run capture:demo -- midweek    the Wednesday or Thursday before kickoff, after waivers clear
//   npm run capture:demo -- gameday    Sunday morning; it then runs until the day's games are over
//
// Environment: API_URL (default http://localhost:8080), LEAGUE_ID, ESPN_S2 and SWID (private
// leagues) and SEASON (default: the current NFL season). For game day, FRAME_MINUTES (default 10)
// and MAX_HOURS (default 15, a cap in case a game never reads as final).
//
// It writes to frontend/demo-raw/<scenario>/, which is gitignored: it still has the league's real
// team and manager names. `npm run scrub:demo` turns it into the committed fixtures. A game-day run
// that's stopped picks up where it left off when run again. It never logs cookies.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AvailablePlayer,
  Draft,
  League,
  LeagueTeamsRequest,
  NflGame,
  NflGameDetail,
  PlayerDetail,
  PlayerHistory,
  Team,
  TeamSummary,
  WeekMatchups,
} from '../src/app/models/team.model';
import { DemoFrame, DemoScenario } from '../src/app/models/demo.model';
import { AVAILABLE_PER_POSITION, startingPositions } from '../src/app/utils/player-rankings';
import { HttpError, defaultSeason, postJson, withRetries } from './capture-helpers';
import {
  RawManifest,
  detailPlayerIds,
  firstKickoff,
  frameGameIds,
  gameDayIds,
  gameDayOver,
  parseScenario,
  rosteredPlayerIds,
} from './capture-demo-helpers';

interface Config {
  apiUrl: string;
  league: LeagueTeamsRequest;
  scenario: DemoScenario;
  outDir: string;
  frameMs: number;
  maxMs: number;
}

// A pause between the many per-player calls, to go easy on ESPN.
const CALL_DELAY_MS = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readConfig(): Config {
  const env = process.env;
  const scenario = parseScenario(process.argv[2]);
  const leagueId = Number(env['LEAGUE_ID']);
  if (!Number.isSafeInteger(leagueId) || leagueId <= 0) {
    throw new Error('LEAGUE_ID must be set to the league’s numeric id.');
  }
  const season = env['SEASON'] ? Number(env['SEASON']) : defaultSeason(new Date());
  if (!Number.isInteger(season)) {
    throw new Error('SEASON must be a year.');
  }
  const frameMinutes = env['FRAME_MINUTES'] ? Number(env['FRAME_MINUTES']) : 10;
  const maxHours = env['MAX_HOURS'] ? Number(env['MAX_HOURS']) : 15;
  if (!(frameMinutes > 0) || !(maxHours > 0)) {
    throw new Error('FRAME_MINUTES and MAX_HOURS must be positive numbers.');
  }
  return {
    apiUrl: (env['API_URL'] || 'http://localhost:8080').replace(/\/+$/, ''),
    league: { leagueId, season, espnS2: env['ESPN_S2'] || undefined, swid: env['SWID'] || undefined },
    scenario,
    outDir: join(__dirname, '..', 'demo-raw', scenario),
    frameMs: frameMinutes * 60 * 1000,
    maxMs: maxHours * 60 * 60 * 1000,
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Capture {
  constructor(private readonly config: Config) {}

  espn<T>(path: string, body: object = {}): Promise<T> {
    return withRetries(() => postJson<T>(this.config.apiUrl, `/api/espn/${path}`, { ...this.config.league, ...body }));
  }

  file(...parts: string[]): string {
    return join(this.config.outDir, ...parts);
  }

  // Everything the app asks for in a week, as it stands now. Returns the week's matchups.
  async base(): Promise<WeekMatchups> {
    const { scenario, league: request } = this.config;
    // Starts clean, so files from an earlier capture can't mix with this one.
    rmSync(this.config.outDir, { recursive: true, force: true });

    const [teams, league, draft, week] = await Promise.all([
      this.espn<TeamSummary[]>('leagues/teams'),
      this.espn<League>('league'),
      this.espn<Draft>('draft'),
      this.espn<WeekMatchups>('matchups'),
    ]);
    const capturedAt = new Date().toISOString();
    const { scoringPeriod } = week;
    console.log(`${league.standings.length} teams, week ${scoringPeriod} of ${request.season}.`);
    writeJson(this.file('teams.json'), teams);
    writeJson(this.file('league.json'), league);
    writeJson(this.file('draft.json'), draft);
    writeJson(this.file('matchups.json'), week);

    for (const { teamId } of teams) {
      writeJson(this.file('team', `${teamId}.json`), await this.espn<Team>('team', { teamId }));
    }

    const positions = startingPositions(league.lineupSlots);
    const [histories, available] = await Promise.all([
      this.espn<PlayerHistory[]>('player-history', { scoringPeriod, playerIds: rosteredPlayerIds(week) }),
      positions.length
        ? this.espn<AvailablePlayer[]>('available-players', { scoringPeriod, positions, perPosition: AVAILABLE_PER_POSITION })
        : Promise.resolve([]),
    ]);
    writeJson(this.file('history.json'), histories);
    writeJson(this.file('available.json'), available);
    console.log(`${histories.length} rostered players, ${available.length} available at ${positions.join(', ')}.`);

    const playerIds = detailPlayerIds(week, available);
    let missing = 0;
    for (const [i, playerId] of playerIds.entries()) {
      try {
        writeJson(this.file('player', `${playerId}.json`), await this.espn<PlayerDetail>('player', { playerId }));
      } catch (error) {
        // One player ESPN can't find shouldn't sink the capture; the demo shows them as unavailable.
        if (!(error instanceof HttpError) || error.status >= 500) throw error;
        missing++;
      }
      if ((i + 1) % 50 === 0) console.log(`Player details: ${i + 1} of ${playerIds.length}.`);
      await sleep(CALL_DELAY_MS);
    }
    console.log(`Player details: ${playerIds.length - missing} saved, ${missing} not found.`);

    let games = 0;
    for (const game of week.nflGames) {
      if (await this.saveGame(this.file('nfl-game', `${game.eventId}.json`), scoringPeriod, game.eventId)) games++;
    }
    console.log(`NFL games: ${games} of ${week.nflGames.length} saved.`);

    const manifest: RawManifest = {
      scenario,
      leagueId: request.leagueId,
      season: request.season,
      scoringPeriod,
      matchupPeriod: week.matchupPeriod,
      capturedAt,
      teamIds: teams.map((t) => t.teamId),
    };
    writeJson(this.file('manifest.json'), manifest);
    return week;
  }

  // Saves one NFL game's detail, or logs why it couldn't and goes on without it.
  async saveGame(path: string, scoringPeriod: number, eventId: string): Promise<boolean> {
    try {
      writeJson(path, await this.espn<NflGameDetail>('nfl-game', { scoringPeriod, eventId }));
      return true;
    } catch (error) {
      console.warn(`NFL game ${eventId} not saved: ${errorMessage(error)}`);
      return false;
    }
  }

  // Frames every frameMs from the day's first kickoff until its games are over, written as they come.
  async gameDay(): Promise<void> {
    const indexPath = this.file('frames', 'index.json');
    const resuming = existsSync(indexPath) && existsSync(this.file('manifest.json'));
    let frames: DemoFrame[] = [];
    let base: WeekMatchups;
    let last: WeekMatchups;
    if (resuming) {
      // An earlier week's recording is never added to, or deleted for you.
      const manifest = readJson<RawManifest>(this.file('manifest.json'));
      const now = await this.espn<WeekMatchups>('matchups');
      if (
        manifest.leagueId !== this.config.league.leagueId ||
        manifest.season !== this.config.league.season ||
        manifest.scoringPeriod !== now.scoringPeriod
      ) {
        throw new Error(
          `${this.config.outDir} holds another capture (week ${manifest.scoringPeriod} of ${manifest.season}). ` +
            'Move or delete it to start a new one.',
        );
      }
      frames = readJson<DemoFrame[]>(indexPath);
      base = readJson<WeekMatchups>(this.file('matchups.json'));
      last = frames.length ? readJson<WeekMatchups>(this.file('frames', String(frames.at(-1)!.frame), 'matchups.json')) : base;
      console.log(`Resuming after frame ${frames.at(-1)?.frame ?? 'none'}.`);
    } else {
      base = await this.base();
      last = base;
      writeJson(indexPath, frames);
    }

    const scoringPeriod = base.scoringPeriod;
    const dayIds = gameDayIds(base.nflGames);
    if (!dayIds.length) {
      console.log('Every game this week is final, so there’s no game day left to record.');
      return;
    }
    const kickoff = firstKickoff(base.nflGames, dayIds)!;
    if (kickoff.getTime() > Date.now()) {
      console.log(`${dayIds.length} games today. Waiting for the first kickoff at ${kickoff.toLocaleString()}.`);
      await sleep(kickoff.getTime() - Date.now());
    }

    const started = Date.now();
    let previous = new Map<string, NflGame['state']>(last.nflGames.map((g) => [g.eventId, g.state]));
    let lastJson = JSON.stringify(last);
    for (let tick = started; ; tick += this.config.frameMs) {
      await sleep(Math.max(0, tick - Date.now()));
      if (Date.now() - started > this.config.maxMs) {
        console.log(`Stopped at MAX_HOURS with games unfinished: ${frames.length} frames recorded.`);
        return;
      }
      let week: WeekMatchups;
      try {
        week = await this.espn<WeekMatchups>('matchups');
      } catch (error) {
        // A failed frame is a gap in the replay, not the end of the day.
        console.warn(`Frame skipped: ${errorMessage(error)}`);
        continue;
      }
      const capturedAt = new Date();
      const gameIds = frameGameIds(week.nflGames, previous);
      const json = JSON.stringify(week);
      if (json === lastJson && !gameIds.length) {
        console.log(`${capturedAt.toLocaleTimeString()}: no change, nothing written.`);
      } else {
        const frame = (frames.at(-1)?.frame ?? -1) + 1;
        const saved: string[] = [];
        for (const eventId of gameIds) {
          if (await this.saveGame(this.file('frames', String(frame), 'nfl-game', `${eventId}.json`), scoringPeriod, eventId)) {
            saved.push(eventId);
          }
        }
        writeJson(this.file('frames', String(frame), 'matchups.json'), week);
        frames.push({ frame, capturedAt: capturedAt.toISOString(), games: saved });
        writeJson(indexPath, frames);
        const live = week.nflGames.filter((g) => g.state === 'in').length;
        console.log(`${capturedAt.toLocaleTimeString()}: frame ${frame}, ${live} live, ${saved.length} game details.`);
        lastJson = json;
      }
      previous = new Map(week.nflGames.map((g) => [g.eventId, g.state]));

      if (gameDayOver(week.nflGames, dayIds, capturedAt)) {
        console.log(`The day’s games are over: ${frames.length} frames recorded.`);
        return;
      }
    }
  }
}

async function run(): Promise<void> {
  const config = readConfig();
  const capture = new Capture(config);
  if (config.scenario === 'midweek') {
    await capture.base();
    console.log(`Mid-week capture written to ${config.outDir}.`);
  } else {
    await capture.gameDay();
  }
}

run().catch((error: unknown) => {
  // The message only: errors from fetch can carry the request they were for.
  console.error(`Capture failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
