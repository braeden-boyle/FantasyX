import { Injectable, signal } from '@angular/core';
import { Team } from '../models/team.model';

@Injectable({ providedIn: 'root' })
export class TeamStateService {
  readonly team = signal<Team | null>(null);

  setTeam(team: Team): void {
    this.team.set(team);
  }
}
