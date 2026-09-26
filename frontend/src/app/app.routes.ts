import { Routes } from '@angular/router';
import { ImportTeamComponent } from './components/import-team/import-team.component';
import { LeagueComponent } from './components/league/league.component';
import { TeamDisplayComponent } from './components/team-display/team-display.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'import' },
  { path: 'import', component: ImportTeamComponent },
  { path: 'league', component: LeagueComponent },
  // Plain /team is the user's own team; /team/:teamId is any team in the league (including their own).
  { path: 'team', component: TeamDisplayComponent },
  { path: 'team/:teamId', component: TeamDisplayComponent },
];
