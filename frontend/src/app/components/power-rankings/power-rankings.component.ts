import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { LeagueOutlookService } from '../../services/league-outlook.service';
import { TeamStateService } from '../../services/team-state.service';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';
import { RankMovementComponent } from '../rank-movement/rank-movement.component';

// The league's power rankings, in one parent container: a card with this week's ranking (rank,
// movement since last week, team), and a separate card below with each team's move since draft day
// as an arrow on a rank track. Rows are static.
// Shown under the standings on wide screens, and on its own page (/league/rankings) below
// that. It reads the shared LeagueOutlookService; the host page decides when the league loads.
@Component({
  selector: 'app-power-rankings',
  standalone: true,
  imports: [DecimalPipe, CardModule, SkeletonModule, ProjectionSourceComponent, RankMovementComponent],
  templateUrl: './power-rankings.component.html',
  styleUrl: './power-rankings.component.css',
})
export class PowerRankingsComponent {
  protected readonly outlook = inject(LeagueOutlookService);
  private readonly teamState = inject(TeamStateService);

  protected readonly view = this.outlook.rankings;
  protected readonly placeholders = computed(() =>
    Array.from({ length: this.outlook.league()?.standings.length || 10 }, (_, i) => i),
  );

  private readonly namesById = computed(
    () => new Map((this.outlook.league()?.standings ?? []).map((s) => [s.teamId, s.name] as const)),
  );

  protected name(teamId: number): string {
    return this.namesById().get(teamId) ?? `Team ${teamId}`;
  }

  protected isMine(teamId: number): boolean {
    return teamId === this.teamState.myTeamId();
  }

  protected readonly Math = Math;
  protected readonly teamCount = computed(() => this.view()?.rankings.length ?? 0);

  // Where a rank sits on the draft-day track, as a percentage from the left: last place at 0,
  // 1st at 100.
  protected position(rank: number): number {
    const n = this.teamCount();
    return n > 1 ? ((n - rank) / (n - 1)) * 100 : 50;
  }

  protected ordinal(n: number): string {
    const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
    const isTeens = n % 100 >= 11 && n % 100 <= 13;
    return `${n}${isTeens ? 'th' : (suffixes[n % 10] ?? 'th')}`;
  }
}
