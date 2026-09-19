export interface Player {
  playerId: number;
  fullName: string;
  position: string;
  proTeam: string;
  slot: string;
  starter: boolean;
  injuryStatus: string | null;
  headshotUrl: string;
}

export interface Team {
  teamId: number;
  name: string;
  abbrev: string;
  wins: number;
  losses: number;
  ties: number;
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
