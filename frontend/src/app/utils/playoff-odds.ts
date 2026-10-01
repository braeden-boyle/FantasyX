import { ScheduledMatchup } from '../models/team.model';

// Each team's chance of making the playoffs (and of a first-round bye), from a Monte Carlo of the
// rest of the regular season. Completed weeks count as played; every later matchup, the current
// week's included, is simulated: each team scores its strength that week (utils/power-rankings.ts,
// built from that week's projections, so byes and opponents are week-specific) plus normal noise
// of one league-wide spread, the higher score wins, and the final table is seeded
// by the league's rules. Late in the season an exact check over every remaining win/loss outcome
// decides who has clinched (x), clinched a bye (y) or been eliminated (e); only then do the odds
// read 100% or 0%.

export const SIMULATIONS = 10_000;
// Fixed, so the odds don't flicker between reloads.
export const SIMULATION_SEED = 2026;

// A team's typical miss against its own average weekly score, used until there are enough weeks
// to measure it from this season's results.
export const FALLBACK_WEEKLY_SPREAD = 25;
export const MIN_WEEKS_FOR_SPREAD = 3;

// The exact clinch check enumerates 2^games outcomes, so it only runs this late in the season.
export const EXACT_CHECK_MAX_WEEKS = 3;
export const EXACT_CHECK_MAX_GAMES = 22;

export type Tiebreak = 'h2h' | 'points';

// ESPN's seeding rule for teams level on record. Head-to-head falls back to points for; anything
// else (intra-division record, points against, ...) is approximated by points for, and flagged.
export function seedingTiebreak(rule: string | null): { tiebreak: Tiebreak; supported: boolean } {
  if (rule === 'H2H_RECORD') return { tiebreak: 'h2h', supported: true };
  if (rule === null || rule === 'TOTAL_POINTS_SCORED') return { tiebreak: 'points', supported: true };
  return { tiebreak: 'points', supported: false };
}

// First-round byes: the bracket is filled up to the next power of two by byes for the top seeds
// (6 teams: 2 byes; 4 or 8 teams: none).
export function byeCount(playoffTeams: number): number {
  if (playoffTeams <= 2) return 0;
  let bracket = 1;
  while (bracket < playoffTeams) bracket *= 2;
  return bracket - playoffTeams;
}

// How far a team's weekly score typically lands from its own average this season (pooled across
// the league, with one degree of freedom per team for the average), or the fallback early on.
export function weeklySpread(schedule: readonly ScheduledMatchup[], beforePeriod: number): number {
  const scores = new Map<number, number[]>();
  const weeks = new Set<number>();
  for (const m of schedule) {
    if (m.matchupPeriod >= beforePeriod || m.awayTeamId === null) continue;
    weeks.add(m.matchupPeriod);
    scores.set(m.homeTeamId, [...(scores.get(m.homeTeamId) ?? []), m.homePoints]);
    scores.set(m.awayTeamId, [...(scores.get(m.awayTeamId) ?? []), m.awayPoints ?? 0]);
  }
  if (weeks.size < MIN_WEEKS_FOR_SPREAD) return FALLBACK_WEEKLY_SPREAD;

  let squares = 0;
  let dof = 0;
  for (const s of scores.values()) {
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    squares += s.reduce((sum, x) => sum + (x - mean) ** 2, 0);
    dof += s.length - 1;
  }
  return dof > 0 ? Math.sqrt(squares / dof) : FALLBACK_WEEKLY_SPREAD;
}

// byPeriod is the team's strength in each remaining matchup period, keyed by period; a period
// missing from it (or no byPeriod at all) uses strength.
export interface OddsTeam {
  teamId: number;
  divisionId: number;
  strength: number;
  byPeriod?: Readonly<Record<number, number>>;
}

function strengthIn(team: OddsTeam, period: number): number {
  return team.byPeriod?.[period] ?? team.strength;
}

export interface OddsInput {
  teams: readonly OddsTeam[];
  schedule: readonly ScheduledMatchup[];
  currentPeriod: number;
  regularSeasonPeriods: number;
  playoffTeamCount: number;
  seedingRule: string | null;
  spread: number;
  simulations?: number;
  seed?: number;
}

export type OddsTag = 'x' | 'y' | 'e';

// bye is null in a league without byes. The clinched/eliminated flags are exact (never set before
// the exact check runs), and are the only way playoff or bye reads exactly 1 or 0.
export interface TeamOdds {
  teamId: number;
  playoff: number;
  bye: number | null;
  clinched: boolean;
  eliminated: boolean;
  clinchedBye: boolean;
  byeEliminated: boolean;
  tag: OddsTag | null;
}

export interface PlayoffOdds {
  teams: TeamOdds[];
  byes: number;
  // False when the league's seeding rule was approximated by points for.
  supportedRule: boolean;
}

// The standings table the simulation works on, indexed by team position in OddsInput.teams. Ties
// count half a win. h2h holds pairwise results (row team's wins over column team, ties half).
interface Table {
  n: number;
  wins: Float64Array;
  games: Float64Array;
  pointsFor: Float64Array;
  h2hWins: Float64Array;
  h2hGames: Float64Array;
}

interface Seeding {
  tiebreak: Tiebreak;
  division: Int32Array;
  useDivisions: boolean;
}

function emptyTable(n: number): Table {
  return {
    n,
    wins: new Float64Array(n),
    games: new Float64Array(n),
    pointsFor: new Float64Array(n),
    h2hWins: new Float64Array(n * n),
    h2hGames: new Float64Array(n * n),
  };
}

function copyTable(from: Table, to: Table): void {
  to.wins.set(from.wins);
  to.games.set(from.games);
  to.pointsFor.set(from.pointsFor);
  to.h2hWins.set(from.h2hWins);
  to.h2hGames.set(from.h2hGames);
}

// homeShare is 1 for a home win, 0 for an away win and 0.5 for a tie.
function record(t: Table, home: number, away: number, homeShare: number, homePoints: number, awayPoints: number): void {
  t.wins[home] += homeShare;
  t.wins[away] += 1 - homeShare;
  t.games[home] += 1;
  t.games[away] += 1;
  t.pointsFor[home] += homePoints;
  t.pointsFor[away] += awayPoints;
  t.h2hWins[home * t.n + away] += homeShare;
  t.h2hWins[away * t.n + home] += 1 - homeShare;
  t.h2hGames[home * t.n + away] += 1;
  t.h2hGames[away * t.n + home] += 1;
}

function winPct(t: Table, i: number): number {
  return t.games[i] ? t.wins[i] / t.games[i] : 0.5;
}

// teams ordered best first: by win percentage, then (among teams level on it) head-to-head record
// within the tied group if the rule says so, then points for, then position for a stable order.
function rankOrder(t: Table, teams: readonly number[], tiebreak: Tiebreak): number[] {
  const byPct = [...teams].sort((a, b) => winPct(t, b) - winPct(t, a) || a - b);
  const order: number[] = [];
  for (let start = 0; start < byPct.length; ) {
    let end = start + 1;
    while (end < byPct.length && winPct(t, byPct[end]) === winPct(t, byPct[start])) end++;
    const group = byPct.slice(start, end);
    if (group.length > 1) {
      const h2h = (i: number): number => {
        if (tiebreak !== 'h2h') return 0;
        let w = 0;
        let g = 0;
        for (const j of group) {
          w += t.h2hWins[i * t.n + j];
          g += t.h2hGames[i * t.n + j];
        }
        return g ? w / g : 0.5;
      };
      group.sort((a, b) => h2h(b) - h2h(a) || t.pointsFor[b] - t.pointsFor[a] || a - b);
    }
    order.push(...group);
    start = end;
  }
  return order;
}

// Final seeds, best first. With divisions, each division's winner is seeded ahead of every other
// team.
function seedOrder(t: Table, seeding: Seeding): number[] {
  const all = Array.from({ length: t.n }, (_, i) => i);
  const order = rankOrder(t, all, seeding.tiebreak);
  if (!seeding.useDivisions) return order;

  const winners = new Set<number>();
  for (const d of new Set(seeding.division)) {
    const members = all.filter((i) => seeding.division[i] === d);
    winners.add(rankOrder(t, members, seeding.tiebreak)[0]);
  }
  return [...order.filter((i) => winners.has(i)), ...order.filter((i) => !winners.has(i))];
}

// mulberry32: a small seeded PRNG, so a given input always gives the same odds.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal draws (Box-Muller).
function normalSampler(random: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

interface Exact {
  clinched: boolean[];
  eliminated: boolean[];
  clinchedBye: boolean[];
  byeEliminated: boolean[];
}

// Whether each team is in the playoffs (or has a bye) in every remaining win/loss outcome, or in
// none. Points aren't settled yet, so any tie on record goes against the team when checking a
// clinch and in its favour when checking elimination. Outcomes are walked in Gray-code order, so
// each step flips one game, and teams stop being checked once both answers are known to be no.
function exactCheck(base: Table, remaining: readonly [number, number][], seeding: Seeding, playoffTeams: number, byes: number): Exact {
  const n = base.n;
  const g = remaining.length;
  const division = seeding.useDivisions ? seeding.division : new Int32Array(n);
  const divisions = [...new Set(division)];
  const divisionIndex = new Int32Array(n).map((_, i) => divisions.indexOf(division[i]));
  const d = divisions.length;

  const totalGames = Float64Array.from(base.games);
  const wins = Float64Array.from(base.wins);
  for (const [, away] of remaining) wins[away] += 1; // outcome 0: every away side wins
  for (const [home, away] of remaining) {
    totalGames[home] += 1;
    totalGames[away] += 1;
  }

  const canMiss = new Array<boolean>(n).fill(false);
  const canMake = new Array<boolean>(n).fill(false);
  // With no byes there's nothing to check, so both bye answers start settled.
  const canMissBye = new Array<boolean>(n).fill(byes === 0);
  const canMakeBye = new Array<boolean>(n).fill(byes === 0);
  const pct = new Float64Array(n);
  const divisionMax = new Float64Array(d);

  // The team's seed when every tie on record goes against it (strict = false) or for it.
  const seedOf = (team: number, strict: boolean): number => {
    const p = pct[team];
    const ahead = (q: number) => (strict ? q > p : q >= p);
    let leader = true;
    let others = 0;
    for (let j = 0; j < n; j++) {
      if (j === team || !ahead(pct[j])) continue;
      others++;
      if (divisionIndex[j] === divisionIndex[team]) leader = false;
    }
    let otherWinners = 0;
    for (let k = 0; k < d; k++) if (k !== divisionIndex[team] && ahead(divisionMax[k])) otherWinners++;
    return leader ? 1 + otherWinners : d + 1 + (others - otherWinners - 1);
  };

  const outcomes = 2 ** g;
  for (let k = 0; k < outcomes; k++) {
    if (k > 0) {
      // Gray code: step k flips the game at the lowest set bit of k.
      const bit = 31 - Math.clz32(k & -k);
      const [home, away] = remaining[bit];
      const homeWins = ((k ^ (k >> 1)) >> bit) & 1;
      wins[home] += homeWins ? 1 : -1;
      wins[away] += homeWins ? -1 : 1;
    }

    divisionMax.fill(-1);
    for (let i = 0; i < n; i++) {
      pct[i] = totalGames[i] ? wins[i] / totalGames[i] : 0.5;
      if (pct[i] > divisionMax[divisionIndex[i]]) divisionMax[divisionIndex[i]] = pct[i];
    }

    let unresolved = false;
    for (let i = 0; i < n; i++) {
      if (canMiss[i] && canMake[i] && canMissBye[i] && canMakeBye[i]) continue;
      unresolved = true;
      const worst = seedOf(i, false);
      const best = seedOf(i, true);
      if (worst > playoffTeams) canMiss[i] = true;
      if (best <= playoffTeams) canMake[i] = true;
      if (worst > byes) canMissBye[i] = true;
      if (best <= byes) canMakeBye[i] = true;
    }
    if (!unresolved) break;
  }

  return {
    clinched: canMiss.map((miss) => !miss),
    eliminated: canMake.map((make) => !make),
    clinchedBye: canMissBye.map((miss) => !miss),
    byeEliminated: canMakeBye.map((make) => !make),
  };
}

// Null when there's nothing to estimate: no playoff settings, or the regular season is over.
export function playoffOdds(input: OddsInput): PlayoffOdds | null {
  const { teams, schedule, currentPeriod, regularSeasonPeriods, playoffTeamCount } = input;
  if (!teams.length || playoffTeamCount <= 0 || regularSeasonPeriods <= 0 || currentPeriod > regularSeasonPeriods) {
    return null;
  }

  const n = teams.length;
  const indexOf = new Map(teams.map((team, i) => [team.teamId, i] as const));
  const playoffTeams = Math.min(playoffTeamCount, n);
  const byes = byeCount(playoffTeams);
  const { tiebreak, supported } = seedingTiebreak(input.seedingRule);
  const division = Int32Array.from(teams, (team) => team.divisionId);
  const divisionCount = new Set(division).size;
  const seeding: Seeding = { tiebreak, division, useDivisions: divisionCount > 1 && divisionCount <= playoffTeams };

  const base = emptyTable(n);
  const remaining: [number, number][] = [];
  const remainingPeriods: number[] = [];
  for (const m of schedule) {
    const home = indexOf.get(m.homeTeamId);
    const away = m.awayTeamId === null ? undefined : indexOf.get(m.awayTeamId);
    if (home === undefined || away === undefined || m.matchupPeriod > regularSeasonPeriods) continue;
    if (m.matchupPeriod >= currentPeriod) {
      remaining.push([home, away]);
      remainingPeriods.push(m.matchupPeriod);
      continue;
    }
    const awayPoints = m.awayPoints ?? 0;
    const homeShare =
      m.winner === 'HOME' ? 1
      : m.winner === 'AWAY' ? 0
      : m.winner === 'TIE' ? 0.5
      : m.homePoints > awayPoints ? 1
      : m.homePoints < awayPoints ? 0
      : 0.5;
    record(base, home, away, homeShare, m.homePoints, awayPoints);
  }

  // Monte Carlo over the remaining matchups.
  const simulations = input.simulations ?? SIMULATIONS;
  const normal = normalSampler(seededRandom(input.seed ?? SIMULATION_SEED));
  const made = new Float64Array(n);
  const madeBye = new Float64Array(n);
  const table = emptyTable(n);
  for (let s = 0; s < simulations; s++) {
    copyTable(base, table);
    for (let g = 0; g < remaining.length; g++) {
      const [home, away] = remaining[g];
      const period = remainingPeriods[g];
      const homePoints = strengthIn(teams[home], period) + input.spread * normal();
      const awayPoints = strengthIn(teams[away], period) + input.spread * normal();
      record(table, home, away, homePoints > awayPoints ? 1 : homePoints < awayPoints ? 0 : 0.5, homePoints, awayPoints);
    }
    const seeds = seedOrder(table, seeding);
    for (let seed = 0; seed < playoffTeams; seed++) {
      made[seeds[seed]]++;
      if (seed < byes) madeBye[seeds[seed]]++;
    }
  }

  const weeksLeft = regularSeasonPeriods - currentPeriod + 1;
  const exact =
    weeksLeft <= EXACT_CHECK_MAX_WEEKS && remaining.length <= EXACT_CHECK_MAX_GAMES
      ? exactCheck(base, remaining, seeding, playoffTeams, byes)
      : null;

  return {
    byes,
    supportedRule: supported,
    teams: teams.map((team, i) => {
      const clinched = exact?.clinched[i] ?? false;
      const eliminated = exact?.eliminated[i] ?? false;
      const clinchedBye = byes > 0 && (exact?.clinchedBye[i] ?? false);
      const byeEliminated = byes > 0 && (exact?.byeEliminated[i] ?? false);
      return {
        teamId: team.teamId,
        playoff: clinched ? 1 : eliminated ? 0 : made[i] / simulations,
        bye: byes === 0 ? null : clinchedBye ? 1 : byeEliminated ? 0 : madeBye[i] / simulations,
        clinched,
        eliminated,
        clinchedBye,
        byeEliminated,
        tag: clinchedBye ? 'y' : clinched ? 'x' : eliminated ? 'e' : null,
      };
    }),
  };
}

// A chance as shown in standings and on the roster tile, to one decimal place. It only reads 100%
// or 0% once that's certain (a team has clinched or been eliminated); until then a near-certainty
// reads ">99.9%" or "<0.1%".
export function formatOdds(probability: number, settled: boolean): string {
  if (settled) return probability >= 0.5 ? '100%' : '0%';
  if (probability > 0.999) return '>99.9%';
  if (probability < 0.001) return '<0.1%';
  return `${(probability * 100).toFixed(1)}%`;
}

export const TAG_LABELS: Readonly<Record<OddsTag, string>> = {
  x: 'Clinched a playoff spot',
  y: 'Clinched a first-round bye',
  e: 'Eliminated from playoff contention',
};
