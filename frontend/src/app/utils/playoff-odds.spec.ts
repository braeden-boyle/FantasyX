import { describe, expect, it } from 'vitest';
import { ScheduledMatchup } from '../models/team.model';
import {
  FALLBACK_WEEKLY_SPREAD,
  OddsInput,
  byeCount,
  formatOdds,
  playoffOdds,
  seedingTiebreak,
  weeklySpread,
} from './playoff-odds';

function game(matchupPeriod: number, homeTeamId: number, homePoints: number, awayTeamId: number, awayPoints: number): ScheduledMatchup {
  const winner = homePoints > awayPoints ? 'HOME' : homePoints < awayPoints ? 'AWAY' : 'TIE';
  return { matchupPeriod, homeTeamId, awayTeamId, homePoints, awayPoints, winner };
}

function upcoming(matchupPeriod: number, homeTeamId: number, awayTeamId: number): ScheduledMatchup {
  return { matchupPeriod, homeTeamId, awayTeamId, homePoints: 0, awayPoints: 0, winner: 'UNDECIDED' };
}

// Every team plays every other once (circle method), all weeks still to play.
function roundRobin(n: number): ScheduledMatchup[] {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const schedule: ScheduledMatchup[] = [];
  for (let week = 1; week < n; week++) {
    for (let i = 0; i < n / 2; i++) schedule.push(upcoming(week, ids[i], ids[n - 1 - i]));
    ids.splice(1, 0, ids.pop()!);
  }
  return schedule;
}

function teams(strengths: number[], divisions?: number[]) {
  return strengths.map((strength, i) => ({ teamId: i + 1, divisionId: divisions?.[i] ?? 0, strength }));
}

// Four teams, two weeks played: 1 is 2-0, 2 and 3 are 1-1, 4 is 0-2. Week 3 (1 v 4, 2 v 3) is left.
const FOUR_TEAM_SCHEDULE = [
  game(1, 1, 100, 2, 90),
  game(1, 3, 100, 4, 90),
  game(2, 1, 100, 3, 90),
  game(2, 2, 100, 4, 90),
  upcoming(3, 1, 4),
  upcoming(3, 2, 3),
];

function fourTeam(overrides: Partial<OddsInput> = {}): OddsInput {
  return {
    teams: teams([100, 100, 100, 100]),
    schedule: FOUR_TEAM_SCHEDULE,
    currentPeriod: 3,
    regularSeasonPeriods: 3,
    playoffTeamCount: 2,
    seedingRule: 'TOTAL_POINTS_SCORED',
    spread: 20,
    simulations: 2000,
    ...overrides,
  };
}

describe('byeCount', () => {
  it('fills the bracket to a power of two', () => {
    expect([2, 3, 4, 6, 8].map(byeCount)).toEqual([0, 1, 0, 2, 0]);
  });
});

describe('seedingTiebreak', () => {
  it('maps ESPN rules, flagging ones approximated by points for', () => {
    expect(seedingTiebreak('H2H_RECORD')).toEqual({ tiebreak: 'h2h', supported: true });
    expect(seedingTiebreak('TOTAL_POINTS_SCORED')).toEqual({ tiebreak: 'points', supported: true });
    expect(seedingTiebreak('INTRA_DIVISION_RECORD')).toEqual({ tiebreak: 'points', supported: false });
  });
});

describe('weeklySpread', () => {
  it('uses the fallback before enough weeks', () => {
    expect(weeklySpread(FOUR_TEAM_SCHEDULE, 3)).toBe(FALLBACK_WEEKLY_SPREAD);
  });

  it('pools each team’s deviation from its own average', () => {
    const schedule = [1, 2, 3].flatMap((week) => [game(week, 1, week % 2 ? 110 : 90, 2, 100)]);
    // Team 1 scores 110, 90, 110 (mean 103.3); team 2 is flat at 100.
    const squares = 2 * (110 - 310 / 3) ** 2 + (90 - 310 / 3) ** 2;
    expect(weeklySpread(schedule, 4)).toBeCloseTo(Math.sqrt(squares / 4), 6);
  });
});

describe('playoffOdds', () => {
  it('is null once the regular season is over or without playoff settings', () => {
    expect(playoffOdds(fourTeam({ currentPeriod: 4 }))).toBeNull();
    expect(playoffOdds(fourTeam({ playoffTeamCount: 0 }))).toBeNull();
  });

  it('gives a dominant team near-certain odds and identical teams P / N', () => {
    const dominant = playoffOdds({
      teams: teams([200, 100, 100, 100, 100, 100, 100, 100]),
      schedule: roundRobin(8),
      currentPeriod: 1,
      regularSeasonPeriods: 7,
      playoffTeamCount: 4,
      seedingRule: null,
      spread: 20,
    })!;
    expect(dominant.teams[0].playoff).toBeGreaterThan(0.99);
    expect(dominant.teams[0].tag).toBeNull(); // too early for the exact check

    const even = playoffOdds({
      teams: teams(Array(8).fill(100)),
      schedule: roundRobin(8),
      currentPeriod: 1,
      regularSeasonPeriods: 7,
      playoffTeamCount: 4,
      seedingRule: null,
      spread: 20,
    })!;
    const total = even.teams.reduce((sum, t) => sum + t.playoff, 0);
    expect(total).toBeCloseTo(4, 6);
    for (const t of even.teams) expect(t.playoff).toBeGreaterThan(0.45);
    for (const t of even.teams) expect(t.playoff).toBeLessThan(0.55);
  });

  it('is deterministic for the same input', () => {
    expect(playoffOdds(fourTeam())).toEqual(playoffOdds(fourTeam()));
  });

  it('tags a team in under every outcome x and one out under every outcome e', () => {
    const odds = playoffOdds(fourTeam())!;
    const [one, two, three, four] = odds.teams;
    // 1 finishes no worse than 2-1, level with at most one team, so even losing the tie it's 2nd.
    expect(one).toMatchObject({ tag: 'x', clinched: true, playoff: 1 });
    // 4 finishes no better than 1-2, behind 1 and the 2 v 3 winner.
    expect(four).toMatchObject({ tag: 'e', eliminated: true, playoff: 0 });
    expect(two.tag).toBeNull();
    expect(three.tag).toBeNull();
    expect(two.playoff).toBeGreaterThan(0);
    expect(two.playoff).toBeLessThan(1);
  });

  it('counts record ties against the team for a clinch', () => {
    // 1 v 2 week 1 is a tie this time: 1 is 1.5-0.5 and could finish level with two teams at 2-1.
    const schedule = [game(1, 1, 100, 2, 100), ...FOUR_TEAM_SCHEDULE.slice(1)];
    const odds = playoffOdds(fourTeam({ schedule }))!;
    expect(odds.teams[0].tag).toBeNull();
    expect(odds.teams[0].playoff).toBeLessThan(1);
  });

  it('puts division winners in ahead of better records', () => {
    // Divisions {1, 2} and {3, 4}, two playoff teams: only the division winners make it.
    const odds = playoffOdds(fourTeam({ teams: teams([100, 100, 100, 100], [1, 1, 2, 2]) }))!;
    const [one, , three, four] = odds.teams;
    // 2-1 isn't safe for 1 any more: 2 can win the division at 2-1 on the tiebreak.
    expect(one.tag).toBeNull();
    // 4 can still win its division: beat 1 and finish level with 3 at 1-2.
    expect(four.tag).toBeNull();
    expect(three.tag).toBeNull();
  });

  it('awards a bye tag only when the bye is certain', () => {
    // Three playoff teams, one bye. 1 is 2-0 with one game left, so the bye isn't settled.
    const odds = playoffOdds(fourTeam({ playoffTeamCount: 3 }))!;
    expect(odds.byes).toBe(1);
    expect(odds.teams[0].tag).toBe('x');
    expect(odds.teams[0].bye).toBeGreaterThan(0);
    expect(odds.teams[0].bye).toBeLessThan(1);

    // A 4-week season with a week left: 1 is 3-0 and everyone else 1-2, so nobody can catch it.
    const schedule = [
      game(1, 1, 100, 2, 90),
      game(1, 3, 100, 4, 90),
      game(2, 1, 100, 3, 90),
      game(2, 4, 100, 2, 90),
      game(3, 1, 100, 4, 90),
      game(3, 2, 100, 3, 90),
      upcoming(4, 1, 2),
      upcoming(4, 3, 4),
    ];
    const locked = playoffOdds(fourTeam({ schedule, currentPeriod: 4, regularSeasonPeriods: 4, playoffTeamCount: 3 }))!;
    expect(locked.teams[0]).toMatchObject({ tag: 'y', clinchedBye: true, bye: 1, playoff: 1 });
  });

  it('breaks record ties by head-to-head or points for, as the league says', () => {
    // After week 3, 2 and 4 are both 2-1. 4 beat 2 head-to-head; 2 has more points.
    const schedule = [
      game(1, 1, 90, 2, 100),
      game(1, 3, 80, 4, 70),
      game(2, 1, 200, 3, 50),
      game(2, 2, 60, 4, 100),
      upcoming(3, 1, 4),
      upcoming(3, 2, 3),
    ];
    const strengths = teams([100, 300, 100, 200]);
    const base = { schedule, teams: strengths, spread: 0, playoffTeamCount: 1, simulations: 10 };
    const h2h = playoffOdds(fourTeam({ ...base, seedingRule: 'H2H_RECORD' }))!;
    const points = playoffOdds(fourTeam({ ...base, seedingRule: 'TOTAL_POINTS_SCORED' }))!;
    expect(h2h.teams[3].playoff).toBe(1);
    expect(points.teams[1].playoff).toBe(1);
  });
});

describe('playoffOdds with per-week strength', () => {
  it('uses a team’s strength in the period it plays, so a weak week costs it', () => {
    // Identical teams, but 2 is far weaker in week 3 (say, a bye-heavy week) than its usual 100.
    const flat = playoffOdds(fourTeam({ teams: teams([100, 100, 100, 100]) }))!;
    const weakWeek = playoffOdds(
      fourTeam({
        teams: teams([100, 100, 100, 100]).map((t) => (t.teamId === 2 ? { ...t, byPeriod: { 3: 40 } } : t)),
      }),
    )!;
    expect(weakWeek.teams[1].playoff).toBeLessThan(flat.teams[1].playoff - 0.2);
    // Its week 3 opponent, 3, benefits.
    expect(weakWeek.teams[2].playoff).toBeGreaterThan(flat.teams[2].playoff + 0.2);
  });
});

describe('formatOdds', () => {
  it('only reads 100% or 0% when settled', () => {
    expect(formatOdds(1, true)).toBe('100%');
    expect(formatOdds(0, true)).toBe('0%');
    expect(formatOdds(1, false)).toBe('>99.9%');
    expect(formatOdds(0, false)).toBe('<0.1%');
    expect(formatOdds(0.7236, false)).toBe('72.4%');
  });
});
