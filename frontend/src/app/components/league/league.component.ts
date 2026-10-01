import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ChipModule } from 'primeng/chip';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { TeamStateService } from '../../services/team-state.service';
import { LeagueOutlookService } from '../../services/league-outlook.service';
import { ProjectionsService } from '../../services/projections.service';
import { TeamLogoComponent } from '../team-logo/team-logo.component';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';
import { PowerRankingsComponent } from '../power-rankings/power-rankings.component';
import { Matchup, MatchupSide, Standing } from '../../models/team.model';
import { TAG_LABELS, TeamOdds, formatOdds } from '../../utils/playoff-odds';
import { involves, mineFirst } from '../../utils/league-format';

@Component({
  selector: 'app-league',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TableModule,
    ChipModule,
    CardModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    TeamLogoComponent,
    ProjectionSourceComponent,
    PowerRankingsComponent,
    TooltipModule,
    SkeletonModule,
  ],
  templateUrl: './league.component.html',
  styleUrl: './league.component.css',
})
export class LeagueComponent {
  protected readonly teamState = inject(TeamStateService);
  protected readonly outlook = inject(LeagueOutlookService);
  private readonly router = inject(Router);
  private readonly projections = inject(ProjectionsService);

  protected readonly myTeamId = this.teamState.myTeamId;

  // Refetched on every visit (and on retry) so standings and live scores are never stale. The
  // league is shared with the roster pages' power rank and playoff odds tiles.
  protected readonly loading = this.outlook.loading;
  protected readonly errorMessage = this.outlook.error;
  protected readonly league = this.outlook.league;
  // When the scores were fetched, so in-progress games are judged against the same moment.
  private readonly scoresAsOf = computed(() => {
    this.league();
    return new Date();
  });

  private readonly standingsById = computed(
    () => new Map((this.league()?.standings ?? []).map((s) => [s.teamId, s] as const)),
  );

  protected readonly matchups = computed<Matchup[]>(() => mineFirst(this.league()?.matchups ?? [], this.myTeamId()));

  constructor() {
    this.outlook.refresh();
  }

  protected retry(): void {
    this.outlook.refresh();
  }

  // Playoff odds for a standings row; undefined while loading, or once the regular season is over.
  protected odds(teamId: number): TeamOdds | undefined {
    return this.outlook.oddsOf(teamId);
  }

  protected readonly showOdds = computed(() => {
    const odds = this.outlook.odds();
    return odds?.status === 'loading' || (odds?.status === 'ready' && odds.odds !== null);
  });
  protected readonly oddsLoading = computed(() => this.outlook.odds()?.status === 'loading');
  protected readonly hasByes = computed(() => {
    const odds = this.outlook.odds();
    return odds?.status === 'ready' && (odds.odds?.byes ?? 0) > 0;
  });
  protected readonly unsupportedRule = computed(() => {
    const odds = this.outlook.odds();
    return odds?.status === 'ready' && odds.odds?.supportedRule === false;
  });

  protected readonly formatOdds = formatOdds;
  protected readonly tagLabels = TAG_LABELS;

  protected standing(teamId: number): Standing | undefined {
    return this.standingsById().get(teamId);
  }

  protected isMine(teamId: number): boolean {
    return teamId === this.myTeamId();
  }

  // The user's own team links to plain /team so the My Team nav tab lights up.
  protected teamLink(teamId: number): string {
    return this.isMine(teamId) ? '/team' : `/team/${teamId}`;
  }

  protected openTeam(teamId: number): void {
    this.router.navigateByUrl(this.teamLink(teamId));
  }

  // The user's own matchup links to plain /matchup so the Matchup nav tab lights up.
  protected openMatchup(m: Matchup): void {
    this.router.navigateByUrl(involves(m, this.myTeamId()) ? '/matchup' : `/matchup/${m.home.teamId}`);
  }

  // A side's projected final score from the active source. In FantasyX mode that's this page's live
  // points plus what the side's starters (from the cached week of matchups) have left.
  protected teamProjection(side: MatchupSide): number | null {
    return this.projections.teamTotal(
      this.projections.weekTeam(side.teamId),
      side.projectedPoints,
      this.scoresAsOf(),
      side.points,
    );
  }

  protected record(s: Standing): string {
    return s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
  }

  protected streakSeverity(streak: string): 'success' | 'danger' | 'secondary' {
    return streak.startsWith('W') ? 'success' : streak.startsWith('L') ? 'danger' : 'secondary';
  }
}
