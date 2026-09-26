import { Injectable, computed, signal } from '@angular/core';
import { ImportTeamRequest, Team } from '../models/team.model';

@Injectable({ providedIn: 'root' })
export class TeamStateService {
  // The user's own imported team. Other teams in the league are fetched on demand, not kept here.
  readonly team = signal<Team | null>(null);

  // The league context (including any private-league cookies) the team was imported with, kept
  // in memory only so follow-up calls like player detail can reuse it. Lost on refresh, like team.
  readonly importRequest = signal<ImportTeamRequest | null>(null);

  readonly myTeamId = computed(() => this.team()?.teamId ?? null);

  setTeam(team: Team, request: ImportTeamRequest): void {
    this.team.set(team);
    this.importRequest.set(request);
  }
}
