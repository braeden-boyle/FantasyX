export interface Player {
  playerId: number;
  fullName: string;
  position: string;
  proTeam: string;
  slot: string;
  starter: boolean;
  injuryStatus: string | null;
  headshotUrl: string;
  isTeamLogo: boolean;
  projectedPoints: number;
  points: number;
  opponent: string | null;
  opponentIsHome: boolean | null;
  gameTimeUtc: string | null;
  opponentPositionRank: number | null;
  // Whether this week's game has ended (official stats). False with no game this week.
  gameFinal: boolean;
}

export interface Team {
  teamId: number;
  name: string;
  abbrev: string;
  leagueName: string;
  wins: number;
  losses: number;
  ties: number;
  standingRank: number;
  leagueSize: number;
  players: Player[];
}

// streak is compact, e.g. "W3"; seed is 0 when ESPN hasn't ranked teams yet. divisionId is 0 in a
// league without divisions.
export interface Standing {
  teamId: number;
  seed: number;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  owners: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: string | null;
  divisionId: number;
}

export interface MatchupSide {
  teamId: number;
  points: number;
  projectedPoints: number | null;
}

export interface Matchup {
  home: MatchupSide;
  away: MatchupSide;
}

// One regular-season matchup, played or not. awayTeamId and awayPoints are null for a bye.
export interface ScheduledMatchup {
  matchupPeriod: number;
  homeTeamId: number;
  awayTeamId: number | null;
  homePoints: number;
  awayPoints: number | null;
  winner: 'HOME' | 'AWAY' | 'TIE' | 'UNDECIDED';
}

// schedule is every regular-season matchup; a period before currentMatchupPeriod is complete.
// scoringPeriodsByMatchupPeriod lists the NFL weeks in each matchup period, keyed by period as a
// string, playoffs included (a playoff round can span two weeks).
// regularSeasonMatchupPeriods and playoffTeamCount are 0 when ESPN doesn't send them.
// lineupSlots are the starting slots (bench, IR and IDP left out).
export interface League {
  leagueName: string;
  currentMatchupPeriod: number;
  standings: Standing[];
  matchups: Matchup[];
  scoringPeriodsByMatchupPeriod: Record<string, number[]>;
  regularSeasonMatchupPeriods: number;
  playoffTeamCount: number;
  playoffSeedingRule: string | null;
  schedule: ScheduledMatchup[];
  lineupSlots: LineupSlot[];
}

// points are totals for the whole matchup period; each player's points are for scoringPeriod only.
export interface MatchupTeam {
  team: Team;
  logoUrl: string | null;
  points: number;
  projectedPoints: number | null;
}

// The current week from POST /api/espn/matchups: every team plus who plays whom. A team missing
// from matchups has no matchup this period; awayTeamId is null for a bye. scoringPeriodsInMatchup
// is more than 1 in multi-week playoff rounds.
export interface WeekMatchups {
  leagueName: string;
  matchupPeriod: number;
  scoringPeriod: number;
  scoringPeriodsInMatchup: number;
  teams: MatchupTeam[];
  matchups: { homeTeamId: number; awayTeamId: number | null }[];
}

// One team's matchup, assembled client-side from WeekMatchups. opponent is null when the team
// has no matchup this period (a bye, or out of the playoffs).
export interface MatchupDetail {
  leagueName: string;
  matchupPeriod: number;
  scoringPeriod: number;
  team: MatchupTeam;
  opponent: MatchupTeam | null;
}

// One draft pick, with the player's week 1 projection (0 when ESPN has none).
export interface DraftPick {
  teamId: number;
  playerId: number;
  position: string;
  week1Projection: number;
}

// A starting lineup slot (bench and IR left out), e.g. FLEX x1 taking RB, WR or TE.
export interface LineupSlot {
  slot: string;
  count: number;
  eligiblePositions: string[];
}

// The league's draft, for the draft-day power ranking. picks is empty before the draft.
export interface Draft {
  picks: DraftPick[];
  lineupSlots: LineupSlot[];
}

export interface TeamSummary {
  teamId: number;
  name: string;
  abbrev: string;
}

export interface LeagueTeamsRequest {
  leagueId: number;
  season: number;
  espnS2?: string;
  swid?: string;
}

export interface ImportTeamRequest extends LeagueTeamsRequest {
  teamId: number;
}

export interface PlayerDetailRequest extends LeagueTeamsRequest {
  playerId: number;
}

export interface PlayerHistoryRequest extends LeagueTeamsRequest {
  scoringPeriod: number;
  playerIds: number[];
}

// One week a player played while projected above 0. opponentPositionRank is the opponent's current
// rank against the player's position (ESPN doesn't expose the rank as it stood that week).
export interface HistoryWeek {
  week: number;
  actual: number;
  projected: number;
  opponentPositionRank: number | null;
}

// A player's weeks before the requested scoring period (empty with none), and ESPN's projection for
// that period and each later NFL week it's projected above 0 (none for a bye or a player ruled out).
export interface PlayerHistory {
  playerId: number;
  weeks: HistoryWeek[];
  upcoming: { week: number; projected: number }[];
}

export interface AvailablePlayersRequest extends LeagueTeamsRequest {
  scoringPeriod: number;
  positions: string[];
  perPosition: number;
}

// A free agent or waiver player from POST /api/espn/available-players. weeks and upcoming follow
// PlayerHistory's rules. percentOwned is across all of ESPN, not this league. points is what they've
// scored in the requested scoring period so far.
export interface AvailablePlayer {
  playerId: number;
  fullName: string;
  position: string;
  proTeam: string;
  injuryStatus: string | null;
  headshotUrl: string;
  isTeamLogo: boolean;
  status: 'FREEAGENT' | 'WAIVERS';
  percentOwned: number;
  points: number;
  weeks: HistoryWeek[];
  upcoming: { week: number; projected: number }[];
}

// One ranked player in a saved snapshot. fantasyTeamId is null unless status is 'ROSTERED';
// weeklyProjections maps each week of the snapshot's window to points.
export interface PlayerRankingSnapshotEntry {
  playerId: number;
  position: string;
  fantasyTeamId: number | null;
  status: 'ROSTERED' | 'FREEAGENT' | 'WAIVERS';
  rank: number;
  positionRank: number;
  restOfSeasonPoints: number;
  value: number;
  weeklyProjections: Record<number, number>;
}

// A league's player rankings for one scoring period and projection source, as the capture workflow
// saves them (POST /api/player-ranking-snapshots). replacementLevels maps position to points.
export interface PlayerRankingSnapshotRequest {
  leagueId: number;
  season: number;
  scoringPeriod: number;
  projectionSource: 'ESPN' | 'FANTASYX';
  firstWeek: number;
  lastWeek: number;
  replacementLevels: Record<string, number>;
  entries: PlayerRankingSnapshotEntry[];
}

export type PlayerGameStatus = 'Played' | 'DidNotPlay' | 'Bye' | 'Upcoming';

export interface PlayerSeasonSummary {
  totalPoints: number;
  averagePoints: number;
  gamesPlayed: number;
  positionRank: number | null;
  seasonProjection: number;
  restOfSeasonProjection: number;
}

// One scoring stat's contribution to a game's points. statValue is the raw stat (or the actual
// points/yards allowed for a D/ST bracket); pointsEach is set only for stats that scale per unit.
export interface ScoringLine {
  label: string;
  statValue: number | null;
  pointsEach: number | null;
  points: number;
}

// statLine lines up index-for-index with PlayerDetail.statColumns. statLine and scoringBreakdown
// are null unless status is 'Played' (and ESPN sent per-stat points for the game).
export interface PlayerGame {
  week: number;
  status: PlayerGameStatus;
  opponent: string | null;
  isHome: boolean | null;
  gameTimeUtc: string | null;
  opponentPositionRank: number | null;
  projectedPoints: number | null;
  points: number | null;
  statLine: string[] | null;
  scoringBreakdown: ScoringLine[] | null;
}

export interface PlayerDetail {
  playerId: number;
  fullName: string;
  position: string;
  proTeam: string;
  injuryStatus: string | null;
  headshotUrl: string;
  isTeamLogo: boolean;
  currentWeek: number;
  summary: PlayerSeasonSummary;
  statColumns: string[];
  games: PlayerGame[];
}

export interface SavedCredentials {
  espnS2: string;
  swid: string;
  lastLeagueId: number | null;
  lastSeason: number | null;
  lastTeamId: number | null;
}

export interface SaveCredentialsRequest {
  espnS2: string;
  swid: string;
  lastLeagueId?: number;
  lastSeason?: number;
  lastTeamId?: number;
}
