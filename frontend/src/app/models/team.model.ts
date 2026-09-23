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

export type PlayerGameStatus = 'Played' | 'DidNotPlay' | 'Bye' | 'Upcoming';

export interface PlayerSeasonSummary {
  totalPoints: number;
  averagePoints: number;
  gamesPlayed: number;
  positionRank: number | null;
  seasonProjection: number;
  restOfSeasonProjection: number;
}

// statLine lines up index-for-index with PlayerDetail.statColumns; null unless status is 'Played'.
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
