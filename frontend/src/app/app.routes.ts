import { Routes } from '@angular/router';
import { ImportTeamComponent } from './components/import-team/import-team.component';
import { TeamDisplayComponent } from './components/team-display/team-display.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'import' },
  { path: 'import', component: ImportTeamComponent },
  { path: 'team', component: TeamDisplayComponent },
];
