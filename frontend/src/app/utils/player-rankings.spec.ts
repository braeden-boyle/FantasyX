import { describe, expect, it } from 'vitest';
import { AvailablePlayer, LineupSlot, MatchupTeam, Player, PlayerHistory, Standing } from '../models/team.model';
import {
  PoolPlayer,
  playoffWeeks,
  scheduleStrength,
  REPLACEMENT_DEPTH,
  RankingsInput,
  buildPlayerRankings,
  playerValues,
  rankPlayers,
  rankingWeeks,
  replacementLevels,
  restOfSeasonPoints,
  snapshotPayload,
  startersByPosition,
  startingPositions,
} from './player-rankings';
import { BIAS_SHRINKAGE_GAMES } from './projections';

const slot = (name: string, count: number, ...eligiblePositions: string[]): LineupSlot => ({
  slot: name,
  count,
  eligiblePositions: eligiblePositions.length ? eligiblePositions : [name],
});

const STANDARD = [slot('QB', 1), slot('RB', 2), slot('WR', 2), slot('TE', 1), slot('FLEX', 1, 'RB', 'WR', 'TE')];

// count players at a position with rest-of-season points from top down by step, ids from firstId.
function players(position: string, count: number, top: number, step: number, firstId: number): PoolPlayer[] {
  return Array.from({ length: count }, (_, i) => ({ playerId: firstId + i, position, restOfSeason: top - i * step }));
}

function rosterPlayer(overrides: Partial<Player>): Player {
  return {
    playerId: 1,
    fullName: 'Test Player',
    position: 'RB',
    proTeam: 'KC',
    slot: 'RB',
    starter: true,
    injuryStatus: null,
    headshotUrl: '',
    isTeamLogo: false,
    projectedPoints: 10,
    points: 0,
    opponent: 'BUF',
    opponentIsHome: true,
    gameTimeUtc: null,
    opponentPositionRank: null,
    gameFinal: false,
    ...overrides,
  };
}

function team(teamId: number, roster: Player[]): MatchupTeam {
  return {
    team: {
      teamId,
      name: `Team ${teamId}`,
      abbrev: `T${teamId}`,
      leagueName: 'Test',
      wins: 0,
      losses: 0,
      ties: 0,
      standingRank: teamId,
      leagueSize: 2,
      players: roster,
    },
    logoUrl: null,
    points: 0,
    projectedPoints: null,
  };
}

function freeAgent(overrides: Partial<AvailablePlayer>): AvailablePlayer {
  return {
    playerId: 100,
    fullName: 'Free Agent',
    position: 'RB',
    proTeam: 'NYJ',
    injuryStatus: null,
    headshotUrl: '',
    isTeamLogo: false,
    status: 'FREEAGENT',
    percentOwned: 10,
    schedule: [],
    points: 0,
    weeks: [],
    upcoming: [],
    ...overrides,
  };
}

// A game against an opponent ranked rank against the position (null when unranked).
const game = (week: number, rank: number | null) => ({ week, opponent: 'NYJ', isHome: true, opponentPositionRank: rank });

// A projection of points in each of the weeks.
const upcoming = (points: number, weeks: number[]) => weeks.map((week) => ({ week, projected: points }));

// Two teams, one RB slot each, weeks 10-12 left (the last matchup period spans two weeks).
function smallLeague(available: AvailablePlayer[] | null, histories: PlayerHistory[] = []): RankingsInput {
  const standings = [{ teamId: 1 }, { teamId: 2 }] as Standing[];
  return {
    league: {
      standings,
      scoringPeriodsByMatchupPeriod: { '9': [9], '10': [10], '11': [11, 12] },
      // Period 11 (weeks 11-12) is the playoffs.
      regularSeasonMatchupPeriods: 10,
      lineupSlots: [slot('RB', 1)],
    },
    week: {
      scoringPeriod: 10,
      teams: [
        team(1, [rosterPlayer({ playerId: 1, fullName: 'Starter One' }), rosterPlayer({ playerId: 3, position: 'K' })]),
        team(2, [rosterPlayer({ playerId: 2, fullName: 'Starter Two', points: 7 })]),
      ],
    },
    histories: [
      { playerId: 1, weeks: [], upcoming: upcoming(20, [10, 11, 12]), schedule: [game(10, 30), game(11, 4), game(12, 8)] },
      // On bye in week 11.
      { playerId: 2, weeks: [], upcoming: upcoming(15, [10, 12]), schedule: [game(10, 20), game(12, null)] },
      ...histories,
    ],
    available,
  };
}

describe('rankingWeeks and restOfSeasonPoints', () => {
  it('cover this week through the last week of the fantasy playoffs', () => {
    expect(rankingWeeks(10, { '1': [1], '13': [13], '14': [14, 15] })).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it('are empty once the playoffs are over, and this week alone without a schedule', () => {
    expect(rankingWeeks(18, { '14': [16, 17] })).toEqual([]);
    expect(rankingWeeks(5, {})).toEqual([5]);
  });

  it('count a week with no projection (a bye) as 0', () => {
    const projected = new Map([[10, 12], [12, 8]]);
    expect(restOfSeasonPoints([10, 11, 12], (w) => projected.get(w) ?? 0)).toBe(20);
  });
});

describe('startersByPosition', () => {
  it('fills a standard league’s flex with the best remaining RB, WR or TE', () => {
    const pool = [
      ...players('QB', 15, 300, 10, 100),
      ...players('RB', 30, 200, 5, 200),
      ...players('WR', 30, 200, 3, 300),
      ...players('TE', 15, 150, 10, 400),
    ];
    const starters = startersByPosition(STANDARD, 10, pool);
    // 20 RBs, 20 WRs and 10 TEs start in their own slots. The 10 flexes go to whoever is best
    // after them: WRs 21-30 (140 down to 113) beat RBs 21-30 (100 down to 55) and TE 11 (50).
    expect(starters.get('QB')).toBe(10);
    expect(starters.get('RB')).toBe(20);
    expect(starters.get('WR')).toBe(30);
    expect(starters.get('TE')).toBe(10);
  });

  it('pulls QBs into the starter count in a superflex league', () => {
    const pool = [...players('QB', 30, 300, 2, 100), ...players('RB', 30, 150, 5, 200)];
    const starters = startersByPosition([slot('QB', 1), slot('RB', 1), slot('OP', 1, 'QB', 'RB', 'WR', 'TE')], 10, pool);
    expect(starters.get('QB')).toBe(20);
    expect(starters.get('RB')).toBe(10);
  });

  it('ranks no kickers in a league without a K slot', () => {
    expect(startingPositions(STANDARD)).toEqual(['QB', 'RB', 'WR', 'TE']);
    const rankings = buildPlayerRankings(smallLeague([]), 'espn')!;
    expect(rankings.players.some((p) => p.position === 'K')).toBe(false);
  });
});

describe('replacementLevels and playerValues', () => {
  const pool = players('RB', 10, 100, 10, 1); // 100, 90, ..., 10

  it('is the mean of the players just below the last starter', () => {
    const levels = replacementLevels(pool, new Map([['RB', 4]]), ['RB']);
    // Starters 100-70; the next REPLACEMENT_DEPTH are 60, 50, 40.
    expect(REPLACEMENT_DEPTH).toBe(3);
    expect(levels.get('RB')).toBe(50);
  });

  it('puts the replacement-level player near 0 and every starter above it', () => {
    const levels = replacementLevels(pool, new Map([['RB', 4]]), ['RB']);
    const values = new Map(playerValues(pool, levels).map((p) => [p.playerId, p.value] as const));
    expect(values.get(6)).toBe(0); // the middle of the three, on 50
    for (const id of [1, 2, 3, 4]) expect(values.get(id)).toBeGreaterThan(0);
  });

  it('uses the last player when nobody is below the starters', () => {
    expect(replacementLevels(pool, new Map([['RB', 10]]), ['RB']).get('RB')).toBe(10);
  });
});

describe('rankPlayers', () => {
  it('ranks by value across positions and by points within one', () => {
    const ranks = rankPlayers([
      { playerId: 1, position: 'QB', restOfSeason: 300, value: 20 },
      { playerId: 2, position: 'RB', restOfSeason: 150, value: 60 },
      { playerId: 3, position: 'RB', restOfSeason: 140, value: 50 },
    ]);
    expect(ranks.get(2)).toEqual({ rank: 1, positionRank: 1 });
    expect(ranks.get(3)).toEqual({ rank: 2, positionRank: 2 });
    expect(ranks.get(1)).toEqual({ rank: 3, positionRank: 1 });
  });

  it('is stable when values tie: more points first, then the lower id', () => {
    const tied = [
      { playerId: 9, position: 'WR', restOfSeason: 100, value: 10 },
      { playerId: 4, position: 'RB', restOfSeason: 100, value: 10 },
      { playerId: 7, position: 'TE', restOfSeason: 120, value: 10 },
    ];
    const ranks = rankPlayers(tied);
    const reversed = rankPlayers([...tied].reverse());
    expect([7, 4, 9].map((id) => ranks.get(id)!.rank)).toEqual([1, 2, 3]);
    expect([...reversed.entries()].sort(([a], [b]) => a - b)).toEqual([...ranks.entries()].sort(([a], [b]) => a - b));
  });
});

describe('buildPlayerRankings', () => {
  const available = [
    freeAgent({ playerId: 100, points: 4.5, upcoming: upcoming(9, [10, 11, 12]) }),
    freeAgent({ playerId: 101, status: 'WAIVERS', upcoming: upcoming(6, [10, 11, 12]) }),
    freeAgent({ playerId: 102, upcoming: upcoming(3, [10, 11, 12]) }),
    // Already on a roster: ESPN's free-agent list hasn't caught up.
    freeAgent({ playerId: 2, upcoming: upcoming(99, [10, 11, 12]) }),
  ];

  it('ranks rostered and available players on rest-of-season value', () => {
    const rankings = buildPlayerRankings(smallLeague(available), 'espn')!;
    expect(rankings.fromWeek).toBe(10);
    expect(rankings.toWeek).toBe(12);
    expect(rankings.rosteredOnly).toBe(false);
    // Starters 60 and 30 (bye in week 11); replacement is (27 + 18 + 9) / 3 = 18.
    expect(rankings.replacementLevels.get('RB')).toBe(18);
    expect(rankings.players.map((p) => [p.playerId, p.rank, p.restOfSeason, p.value, p.status])).toEqual([
      [1, 1, 60, 42, 'ROSTERED'],
      [2, 2, 30, 12, 'ROSTERED'],
      [100, 3, 27, 9, 'FREEAGENT'],
      [101, 4, 18, 0, 'WAIVERS'],
      [102, 5, 9, -9, 'FREEAGENT'],
    ]);
    expect(rankings.players[1]).toMatchObject({ fantasyTeamId: 2, weeklyProjections: { 10: 15, 11: 0, 12: 15 } });
    expect(rankings.players[1]).toMatchObject({ weekProjected: 15, weekPoints: 7 });
    expect(rankings.players[2]).toMatchObject({ weekProjected: 9, weekPoints: 4.5 });
    expect(rankings.players[2].fantasyTeamId).toBeNull();
  });

  it('adds each player’s own bias in FantasyX mode, free agents included', () => {
    const missedBy = (n: number, by: number) =>
      Array.from({ length: n }, (_, i) => ({ week: i + 1, actual: 10 + by, projected: 10, opponentPositionRank: null }));
    // Beat ESPN by 5 a game in weeks 1-5.
    const agent = freeAgent({ playerId: 100, upcoming: upcoming(9, [10, 11, 12]), weeks: missedBy(5, 5) });
    const espn = buildPlayerRankings(smallLeague([agent]), 'espn')!;
    const fantasyX = buildPlayerRankings(smallLeague([agent]), 'fantasyx')!;
    const ros = (r: typeof espn) => r.players.find((p) => p.playerId === 100)!.restOfSeason;
    const bias = 25 / (5 + BIAS_SHRINKAGE_GAMES);
    expect(ros(fantasyX) - ros(espn)).toBeCloseTo(3 * bias);
    expect(fantasyX.players.find((p) => p.playerId === 100)).toMatchObject({ gamesPlayed: 5, seasonPoints: 75, seasonAverage: 15 });
  });

  it('ranks on this week alone for a week ranking', () => {
    const rankings = buildPlayerRankings(smallLeague(available), 'espn', 'week')!;
    expect([rankings.horizon, rankings.fromWeek, rankings.toWeek]).toEqual(['week', 10, 10]);
    // Starters 20 and 15 this week; replacement is (9 + 6 + 3) / 3 = 6.
    expect(rankings.replacementLevels.get('RB')).toBe(6);
    expect(rankings.players.map((p) => [p.playerId, p.restOfSeason, p.value])).toEqual([
      [1, 20, 14],
      [2, 15, 9],
      [100, 9, 3],
      [101, 6, 0],
      [102, 3, -3],
    ]);
    expect(rankings.players[1].weeklyProjections).toEqual({ 10: 15 });
    expect(() => snapshotPayload(rankings, { leagueId: 1, season: 2026 })).toThrow();
  });

  it('finds this week’s game and the opponents’ average rank, rest of season and playoffs', () => {
    const rankings = buildPlayerRankings(smallLeague(available), 'espn')!;
    expect(rankings.playoffWeeks).toEqual([11, 12]);
    const [one, two] = rankings.players;
    expect(one).toMatchObject({ game: { week: 10, opponentPositionRank: 30 }, restOfSeasonSchedule: 14, playoffSchedule: 6 });
    // On bye in week 11, and an unranked opponent in week 12, which is left out.
    expect(two).toMatchObject({ restOfSeasonSchedule: 20, playoffSchedule: null });
    expect(rankings.players[2]).toMatchObject({ game: null, restOfSeasonSchedule: null, playoffSchedule: null });
  });

  it('ranks rostered players only when the available players failed', () => {
    const rankings = buildPlayerRankings(smallLeague(null), 'espn')!;
    expect(rankings.rosteredOnly).toBe(true);
    expect(rankings.players.map((p) => p.playerId)).toEqual([1, 2]);
  });

  it('is null once the playoffs are over', () => {
    const input = smallLeague([]);
    expect(buildPlayerRankings({ ...input, week: { ...input.week, scoringPeriod: 13 } }, 'espn')).toBeNull();
  });
});

describe('snapshotPayload', () => {
  const league = { leagueId: 42, season: 2026 };

  it('includes every ranked player, free agents without a team', () => {
    const available = [freeAgent({ playerId: 100, status: 'WAIVERS', upcoming: upcoming(9, [10, 11, 12]) })];
    const rankings = buildPlayerRankings(smallLeague(available), 'fantasyx')!;
    const payload = snapshotPayload(rankings, league);
    expect(payload).toMatchObject({
      leagueId: 42,
      season: 2026,
      scoringPeriod: 10,
      projectionSource: 'FANTASYX',
      firstWeek: 10,
      lastWeek: 12,
    });
    expect(payload.entries).toHaveLength(rankings.players.length);
    expect(payload.entries.find((e) => e.playerId === 100)).toMatchObject({
      fantasyTeamId: null,
      status: 'WAIVERS',
      weeklyProjections: { 10: 9, 11: 9, 12: 9 },
    });
    expect(payload.entries.find((e) => e.playerId === 1)).toMatchObject({ fantasyTeamId: 1, status: 'ROSTERED' });
    // Only the waiver player is below the two starters.
    expect(payload.replacementLevels).toEqual({ RB: 27 });
  });

  it('refuses rostered-only or missing rankings', () => {
    expect(() => snapshotPayload(buildPlayerRankings(smallLeague(null), 'espn'), league)).toThrow();
    expect(() => snapshotPayload(null, league)).toThrow();
  });
});

describe('playoffWeeks and scheduleStrength', () => {
  it('lists the weeks of every matchup period after the regular season', () => {
    expect(playoffWeeks({ '13': [13], '14': [14], '15': [15], '16': [16, 17] }, 14)).toEqual([15, 16, 17]);
    expect(playoffWeeks({ '15': [15] }, 0)).toEqual([]);
  });

  it('averages the ranked opponents in the weeks', () => {
    const schedule = [game(5, 10), game(6, 20), game(7, null), game(9, 32)];
    expect(scheduleStrength(schedule, [5, 6, 7, 8])).toBe(15);
    expect(scheduleStrength(schedule, [7, 8])).toBeNull();
  });
});
