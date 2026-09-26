import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ImportTeamRequest,
  League,
  LeagueTeamsRequest,
  PlayerDetail,
  PlayerDetailRequest,
  Team,
  TeamSummary,
} from '../models/team.model';

@Injectable({ providedIn: 'root' })
export class EspnApiService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/espn`;

  constructor(private readonly http: HttpClient) {}

  listTeams(request: LeagueTeamsRequest): Observable<TeamSummary[]> {
    return this.http.post<TeamSummary[]>(`${this.baseUrl}/leagues/teams`, request);
  }

  getLeague(request: LeagueTeamsRequest): Observable<League> {
    return this.http.post<League>(`${this.baseUrl}/league`, request);
  }

  getTeam(request: ImportTeamRequest): Observable<Team> {
    return this.http.post<Team>(`${this.baseUrl}/team`, request);
  }

  getPlayer(request: PlayerDetailRequest): Observable<PlayerDetail> {
    return this.http.post<PlayerDetail>(`${this.baseUrl}/player`, request);
  }
}
