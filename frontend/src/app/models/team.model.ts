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

// streak is compact, e.g. "W3"; seed is 0 when ESPN hasn't ranked teams yet.
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

export interface League {
  leagueName: string;
  currentMatchupPeriod: number;
  standings: Standing[];
  matchups: Matchup[];
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

export interface PlayerSpreadsRequest extends LeagueTeamsRequest {
  scoringPeriod: number;
  playerIds: number[];
}

// meanSquaredError is the mean of (actual - projected)^2 over gamesUsed weeks this season.
export interface PlayerSpread {
  playerId: number;
  gamesUsed: number;
  meanSquaredError: number;
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
