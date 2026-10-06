import {
  AvailablePlayer,
  HistoryWeek,
  League,
  LineupSlot,
  PlayerHistory,
  PlayerRankingSnapshotRequest,
  WeekMatchups,
} from '../models/team.model';
import { slotFillOrder } from './power-rankings';
import { ProjectionSource, upcomingProjection } from './projections';

// FantasyX's player rankings rank every player who matters in the league, rostered or available,
// by rest-of-season value over replacement:
//   value = rest-of-season points - the replacement level at the player's position
// Rest-of-season points sum the active source's projection from this week through the last week of
// the fantasy playoffs. The replacement level is what a freely available player at the position is
// projected for, set by how many players start there across the league. Who rosters a player
// doesn't come into it, so value means the same for a rostered player and a free agent. Both the
// Players page and the weekly capture script build rankings here. See docs/PLAN.md, v1.9.

// How many players just below the last starter at a position set its replacement level. Averaging
// a few means one injured or unprojected player doesn't move the whole position.
export const REPLACEMENT_DEPTH = 3;

// How many of the most-owned free agents and waiver players are fetched at each starting position.
// Enough that the replacement level comes from what's actually available, not the worst rostered
// starters, even at K and D/ST.
export const AVAILABLE_PER_POSITION = 50;

export type RankedStatus = 'ROSTERED' | 'FREEAGENT' | 'WAIVERS';

// What a ranking covers: the rest of the season (this week through the last week of the fantasy
// playoffs), or this week alone. The same method ranks both; this week's just has a one-week window,
// so its replacement levels are what a free agent is projected for this week.
export type RankingHorizon = 'restOfSeason' | 'week';

// What the starter count and replacement levels need of each player.
export interface PoolPlayer {
  playerId: number;
  position: string;
  restOfSeason: number;
}

export interface ValuedPlayer extends PoolPlayer {
  value: number;
}

export interface PlayerRanks {
  rank: number;
  positionRank: number;
}

// One ranked player. fantasyTeamId is null for a free agent or waiver player. weeklyProjections maps
// every week of the window to the active source's projection (0 for a week they aren't projected);
// weekProjected is this week's, and weekPoints what they've scored this week as of the rosters' load.
// The season figures come from the weeks they played while projected; seasonAverage is null with
// none.
export interface RankedPlayer extends ValuedPlayer, PlayerRanks {
  fullName: string;
  proTeam: string;
  injuryStatus: string | null;
  headshotUrl: string;
  isTeamLogo: boolean;
  fantasyTeamId: number | null;
  status: RankedStatus;
  weeklyProjections: Record<number, number>;
  weekProjected: number;
  weekPoints: number;
  seasonPoints: number;
  gamesPlayed: number;
  seasonAverage: number | null;
}

// players are in rank order, and each one's restOfSeason is their points over fromWeek-toWeek (this
// week alone for a 'week' ranking). positions are the league's starting positions, in slot order.
// rosteredOnly: available players failed to load, so only rostered players are ranked and the
// replacement levels come from the worst rostered players.
export interface PlayerRankings {
  source: ProjectionSource;
  horizon: RankingHorizon;
  scoringPeriod: number;
  fromWeek: number;
  toWeek: number;
  positions: string[];
  replacementLevels: Map<string, number>;
  players: RankedPlayer[];
  rosteredOnly: boolean;
}

// Plain API data: the league (slots, teams, weeks per matchup period), this week's rosters, every
// rostered player's history and upcoming projections, and the available players (null when they
// failed to load).
export interface RankingsInput {
  league: Pick<League, 'standings' | 'scoringPeriodsByMatchupPeriod' | 'lineupSlots'>;
  week: Pick<WeekMatchups, 'scoringPeriod' | 'teams'>;
  histories: readonly PlayerHistory[];
  available: readonly AvailablePlayer[] | null;
}

// The league's starting positions, in slot order, e.g. QB, RB, WR, TE, D/ST, K. A position no slot
// takes (K in a league without kickers) isn't ranked.
export function startingPositions(slots: readonly LineupSlot[]): string[] {
  return [...new Set(slots.flatMap((s) => s.eligiblePositions))];
}

// The NFL weeks rankings cover: this one through the last week of the fantasy playoffs. Empty once
// that week has passed. Without ESPN's schedule settings, this week only.
export function rankingWeeks(scoringPeriod: number, scoringPeriodsByMatchupPeriod: Record<string, number[]>): number[] {
  const scheduled = Object.values(scoringPeriodsByMatchupPeriod).flat();
  const last = scheduled.length ? Math.max(...scheduled) : scoringPeriod;
  return Array.from({ length: Math.max(0, last - scoringPeriod + 1) }, (_, i) => scoringPeriod + i);
}

// The sum of a player's projection over the weeks. A week they aren't projected (a bye, or ruled
// out) counts 0, so byes and injuries already lower the total.
export function restOfSeasonPoints(weeks: readonly number[], projectionFor: (week: number) => number): number {
  return weeks.reduce((sum, week) => sum + projectionFor(week), 0);
}

// Best first; equal points fall back to player id, so the order is stable.
function byRestOfSeason(a: PoolPlayer, b: PoolPlayer): number {
  return b.restOfSeason - a.restOfSeason || a.playerId - b.playerId;
}

// How many players start at each position across the league. Each slot is filled once per team in
// bestLineupTotal's order (most restrictive first) with the best player left who can play it, so a
// dedicated slot takes count x teams of its position, and flex slots (RB/WR/TE, OP, ...) go to the
// best remaining eligible players, whatever their position.
export function startersByPosition(
  slots: readonly LineupSlot[],
  teamCount: number,
  pool: readonly PoolPlayer[],
): Map<string, number> {
  const available = [...pool].sort(byRestOfSeason);
  const used = new Set<number>();
  const starters = new Map<string, number>();
  for (const slot of slotFillOrder(slots)) {
    for (let team = 0; team < teamCount; team++) {
      const pick = available.find((p) => !used.has(p.playerId) && slot.eligiblePositions.includes(p.position));
      if (!pick) break;
      used.add(pick.playerId);
      starters.set(pick.position, (starters.get(pick.position) ?? 0) + 1);
    }
  }
  return starters;
}

// Each position's replacement level: the mean rest-of-season points of the REPLACEMENT_DEPTH players
// just below its last starter. With fewer below, the ones there are; with none, the last player's,
// so the worst starter sits at 0. A position with no players gets no level.
export function replacementLevels(
  pool: readonly PoolPlayer[],
  starters: ReadonlyMap<string, number>,
  positions: readonly string[],
): Map<string, number> {
  const levels = new Map<string, number>();
  for (const position of positions) {
    const ranked = pool.filter((p) => p.position === position).sort(byRestOfSeason);
    if (!ranked.length) continue;
    const startCount = starters.get(position) ?? 0;
    const below = ranked.slice(startCount, startCount + REPLACEMENT_DEPTH);
    levels.set(
      position,
      below.length
        ? below.reduce((sum, p) => sum + p.restOfSeason, 0) / below.length
        : ranked[ranked.length - 1].restOfSeason,
    );
  }
  return levels;
}

// Each player's rest-of-season points over the replacement level at their position. Players at a
// position with no level are left out.
export function playerValues(pool: readonly PoolPlayer[], levels: ReadonlyMap<string, number>): ValuedPlayer[] {
  return pool.flatMap((p) => {
    const level = levels.get(p.position);
    return level === undefined ? [] : [{ ...p, value: p.restOfSeason - level }];
  });
}

// Overall ranks by value, so positions compare, and position ranks by rest-of-season points. Equal
// values fall back to rest-of-season points, then player id, so the order is stable.
export function rankPlayers(players: readonly ValuedPlayer[]): Map<number, PlayerRanks> {
  const overall = [...players].sort((a, b) => b.value - a.value || byRestOfSeason(a, b));
  const seenAtPosition = new Map<string, number>();
  const positionRanks = new Map<number, number>();
  for (const p of [...players].sort(byRestOfSeason)) {
    const n = (seenAtPosition.get(p.position) ?? 0) + 1;
    seenAtPosition.set(p.position, n);
    positionRanks.set(p.playerId, n);
  }
  return new Map(overall.map((p, i) => [p.playerId, { rank: i + 1, positionRank: positionRanks.get(p.playerId)! }] as const));
}

interface Candidate {
  playerId: number;
  fullName: string;
  position: string;
  proTeam: string;
  injuryStatus: string | null;
  headshotUrl: string;
  isTeamLogo: boolean;
  fantasyTeamId: number | null;
  status: RankedStatus;
  weekPoints: number;
  weeks: readonly HistoryWeek[];
  upcoming: ReadonlyMap<number, number>;
}

// The whole pipeline, from plain API data to the ranked list. Null once the fantasy playoffs are
// over and there's nothing left to rank.
export function buildPlayerRankings(
  input: RankingsInput,
  source: ProjectionSource,
  horizon: RankingHorizon = 'restOfSeason',
): PlayerRankings | null {
  const { league, week, histories, available } = input;
  const remaining = rankingWeeks(week.scoringPeriod, league.scoringPeriodsByMatchupPeriod);
  if (!remaining.length) return null;
  const weeks = horizon === 'week' ? remaining.slice(0, 1) : remaining;

  const positions = startingPositions(league.lineupSlots);
  const ranked = new Set(positions);
  const historyById = new Map(histories.map((h) => [h.playerId, h] as const));
  const candidates = new Map<number, Candidate>();

  for (const { team } of week.teams) {
    for (const p of team.players) {
      if (!ranked.has(p.position) || candidates.has(p.playerId)) continue;
      const history = historyById.get(p.playerId);
      candidates.set(p.playerId, {
        ...identity(p),
        fantasyTeamId: team.teamId,
        status: 'ROSTERED',
        weekPoints: p.points,
        weeks: history?.weeks ?? [],
        upcoming: upcomingByWeek(history?.upcoming ?? []),
      });
    }
  }
  // A player on a roster stays rostered, even if ESPN's free-agent list hasn't caught up yet.
  for (const p of available ?? []) {
    if (!ranked.has(p.position) || candidates.has(p.playerId)) continue;
    candidates.set(p.playerId, {
      ...identity(p),
      fantasyTeamId: null,
      status: p.status,
      weekPoints: p.points,
      weeks: p.weeks,
      upcoming: upcomingByWeek(p.upcoming),
    });
  }

  const projected = new Map(
    [...candidates.values()].map((c) => {
      const byWeek: Record<number, number> = {};
      for (const w of weeks) byWeek[w] = upcomingProjection(source, c.upcoming.get(w) ?? 0, c.weeks, w);
      return [c.playerId, byWeek] as const;
    }),
  );
  const pool: PoolPlayer[] = [...candidates.values()].map((c) => ({
    playerId: c.playerId,
    position: c.position,
    restOfSeason: restOfSeasonPoints(weeks, (w) => projected.get(c.playerId)![w]),
  }));

  const levels = replacementLevels(
    pool,
    startersByPosition(league.lineupSlots, league.standings.length, pool),
    positions,
  );
  const valued = playerValues(pool, levels);
  const ranks = rankPlayers(valued);

  const players = valued
    .map((v): RankedPlayer => {
      const c = candidates.get(v.playerId)!;
      const seasonPoints = c.weeks.reduce((sum, w) => sum + w.actual, 0);
      return {
        ...v,
        ...ranks.get(v.playerId)!,
        fullName: c.fullName,
        proTeam: c.proTeam,
        injuryStatus: c.injuryStatus,
        headshotUrl: c.headshotUrl,
        isTeamLogo: c.isTeamLogo,
        fantasyTeamId: c.fantasyTeamId,
        status: c.status,
        weeklyProjections: projected.get(v.playerId)!,
        weekProjected: projected.get(v.playerId)![week.scoringPeriod],
        weekPoints: c.weekPoints,
        seasonPoints,
        gamesPlayed: c.weeks.length,
        seasonAverage: c.weeks.length ? seasonPoints / c.weeks.length : null,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  return {
    source,
    horizon,
    scoringPeriod: week.scoringPeriod,
    fromWeek: weeks[0],
    toWeek: weeks[weeks.length - 1],
    positions,
    replacementLevels: levels,
    players,
    rosteredOnly: available === null,
  };
}

function identity(p: Omit<Candidate, 'fantasyTeamId' | 'status' | 'weekPoints' | 'weeks' | 'upcoming'>) {
  const { playerId, fullName, position, proTeam, injuryStatus, headshotUrl, isTeamLogo } = p;
  return { playerId, fullName, position, proTeam, injuryStatus, headshotUrl, isTeamLogo };
}

function upcomingByWeek(upcoming: readonly { week: number; projected: number }[]): Map<number, number> {
  return new Map(upcoming.map((u) => [u.week, u.projected] as const));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// The snapshot request for a league's rankings. Only complete rest-of-season rankings are saved: it
// refuses none at all, a this-week ranking, rankings without the available players (rostered only),
// and an empty list.
export function snapshotPayload(
  rankings: PlayerRankings | null,
  league: { leagueId: number; season: number },
): PlayerRankingSnapshotRequest {
  if (!rankings || !rankings.players.length) throw new Error('There are no rankings to save.');
  if (rankings.horizon !== 'restOfSeason') throw new Error('Only rest-of-season rankings are saved.');
  if (rankings.rosteredOnly) {
    throw new Error('These rankings are missing the available players, so they are incomplete.');
  }
  return {
    leagueId: league.leagueId,
    season: league.season,
    scoringPeriod: rankings.scoringPeriod,
    projectionSource: rankings.source === 'fantasyx' ? 'FANTASYX' : 'ESPN',
    firstWeek: rankings.fromWeek,
    lastWeek: rankings.toWeek,
    replacementLevels: Object.fromEntries([...rankings.replacementLevels].map(([pos, level]) => [pos, round2(level)])),
    entries: rankings.players.map((p) => ({
      playerId: p.playerId,
      position: p.position,
      fantasyTeamId: p.fantasyTeamId,
      status: p.status,
      rank: p.rank,
      positionRank: p.positionRank,
      restOfSeasonPoints: round2(p.restOfSeason),
      value: round2(p.value),
      weeklyProjections: Object.fromEntries(
        Object.entries(p.weeklyProjections).map(([week, points]) => [week, round2(points)]),
      ),
    })),
  };
}
