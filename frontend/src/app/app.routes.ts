import { Routes } from '@angular/router';
import { ImportTeamComponent } from './components/import-team/import-team.component';
import { LeagueComponent } from './components/league/league.component';
import { MatchupComponent } from './components/matchup/matchup.component';
import { PowerRankingsPageComponent } from './components/power-rankings-page/power-rankings-page.component';
import { TeamDisplayComponent } from './components/team-display/team-display.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'import' },
  { path: 'import', component: ImportTeamComponent },
  { path: 'league', component: LeagueComponent },
  // The power rankings on their own page, for screens too narrow to show them beside the standings.
  { path: 'league/rankings', component: PowerRankingsPageComponent },
  // Plain /team is the user's own team; /team/:teamId is any team in the league (including their own).
  { path: 'team', component: TeamDisplayComponent },
  { path: 'team/:teamId', component: TeamDisplayComponent },
  // Plain /matchup is the user's own matchup; /matchup/:teamId is that team's current matchup.
  { path: 'matchup', component: MatchupComponent },
  { path: 'matchup/:teamId', component: MatchupComponent },
  // FantasyX's player rankings, rostered and available players alike. Loaded on first visit, to keep
  // its table and filters out of the initial bundle.
  {
    path: 'players',
    loadComponent: () =>
      import('./components/player-rankings/player-rankings.component').then((m) => m.PlayerRankingsComponent),
  },
];
