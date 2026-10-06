// Saves this week's player rankings for one league, in both projection modes, as snapshots for a
// later backtest of value against what players went on to score. ESPN doesn't keep old projections,
// so this is the only way to have them. Run weekly by .github/workflows/capture-player-rankings.yml,
// or locally against a running backend:
//
//   npm run capture:rankings
//
// Environment: API_URL (default http://localhost:8080), LEAGUE_ID, ESPN_S2 and SWID (private
// leagues), CAPTURE_KEY (the backend's Snapshots:CaptureKey) and SEASON (default: the current NFL
// season). It fetches through the backend's own endpoints and ranks with the same code as the
// Players page, so a snapshot is exactly what the page showed. It imports only utils/ and models/.
//
// The Actions logs are public, so it only ever logs counts and ranks, never cookies or keys.

import {
  AvailablePlayer,
  League,
  LeagueTeamsRequest,
  PlayerHistory,
  PlayerRankingSnapshotRequest,
  WeekMatchups,
} from '../src/app/models/team.model';
import {
  AVAILABLE_PER_POSITION,
  buildPlayerRankings,
  snapshotPayload,
  startingPositions,
} from '../src/app/utils/player-rankings';
import { ProjectionSource } from '../src/app/utils/projections';
import { HttpError, captureWindow, defaultSeason, withRetries } from './capture-helpers';

interface Config {
  apiUrl: string;
  league: LeagueTeamsRequest;
  captureKey: string;
}

interface SnapshotSaved {
  snapshotId: number;
  created: boolean;
}

const SOURCES: { source: ProjectionSource; label: string }[] = [
  { source: 'espn', label: 'ESPN' },
  { source: 'fantasyx', label: 'FantasyX' },
];

function readConfig(): Config {
  const env = process.env;
  const leagueId = Number(env['LEAGUE_ID']);
  if (!Number.isSafeInteger(leagueId) || leagueId <= 0) {
    throw new Error('LEAGUE_ID must be set to the league’s numeric id.');
  }
  const captureKey = env['CAPTURE_KEY'];
  if (!captureKey) {
    throw new Error('CAPTURE_KEY must be set to the backend’s Snapshots:CaptureKey.');
  }
  const season = env['SEASON'] ? Number(env['SEASON']) : defaultSeason(new Date());
  if (!Number.isInteger(season)) {
    throw new Error('SEASON must be a year.');
  }
  return {
    apiUrl: (env['API_URL'] || 'http://localhost:8080').replace(/\/+$/, ''),
    // Unset repository secrets arrive as empty strings; a public league needs no cookies.
    league: { leagueId, season, espnS2: env['ESPN_S2'] || undefined, swid: env['SWID'] || undefined },
    captureKey,
  };
}

async function post<T>(config: Config, path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // The backend's problem titles never echo cookies back, so they're safe to log.
    const title = await response
      .json()
      .then((problem: { title?: string }) => problem.title)
      .catch(() => undefined);
    throw new HttpError(response.status, `${path} answered ${response.status}${title ? `: ${title}` : ''}`);
  }
  return (await response.json()) as T;
}

async function capture(): Promise<void> {
  const config = readConfig();
  const espn = <T>(path: string, body: object) =>
    withRetries(() => post<T>(config, `/api/espn/${path}`, { ...config.league, ...body }));

  const [league, week] = await Promise.all([espn<League>('league', {}), espn<WeekMatchups>('matchups', {})]);
  const rosteredIds = [...new Set(week.teams.flatMap((t) => t.team.players.map((p) => p.playerId)))];

  const window = captureWindow(week.scoringPeriod, league.scoringPeriodsByMatchupPeriod, rosteredIds.length);
  if (window !== 'open') {
    console.log(
      window === 'before'
        ? 'Nothing to capture: the season hasn’t started (no players are rostered yet).'
        : 'Nothing to capture: the fantasy playoffs are over.',
    );
    return;
  }

  const positions = startingPositions(league.lineupSlots);
  if (!positions.length) {
    throw new Error('The league’s lineup slots came back empty, so there’s nothing to rank.');
  }
  const { scoringPeriod } = week;
  const [histories, available] = await Promise.all([
    espn<PlayerHistory[]>('player-history', { scoringPeriod, playerIds: rosteredIds }),
    espn<AvailablePlayer[]>('available-players', { scoringPeriod, positions, perPosition: AVAILABLE_PER_POSITION }),
  ]);
  console.log(
    `Week ${scoringPeriod} of ${config.league.season}: ${rosteredIds.length} rostered players, ` +
      `${available.length} available at ${positions.join(', ')}.`,
  );

  for (const { source, label } of SOURCES) {
    const rankings = buildPlayerRankings({ league, week, histories, available }, source);
    // Throws on incomplete rankings, so they're never saved.
    const payload: PlayerRankingSnapshotRequest = snapshotPayload(rankings, config.league);
    const saved = await withRetries(() =>
      post<SnapshotSaved>(config, '/api/player-ranking-snapshots', payload, { 'X-Capture-Key': config.captureKey }),
    );
    if (!saved.created) {
      console.log(`${label}: week ${scoringPeriod} was already saved, so nothing was written.`);
      continue;
    }
    const top = rankings!.players
      .slice(0, 5)
      .map((p) => `${p.rank}. ${p.fullName} (${p.position}${p.positionRank}, ${p.value >= 0 ? '+' : ''}${p.value.toFixed(1)})`)
      .join('; ');
    console.log(
      `${label}: saved ${payload.entries.length} players, weeks ${payload.firstWeek}-${payload.lastWeek}. Top 5: ${top}.`,
    );
  }
}

capture().catch((error: unknown) => {
  // The message only: errors from fetch can carry the request they were for.
  console.error(`Capture failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
