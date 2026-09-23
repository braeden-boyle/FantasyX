import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AvatarModule } from 'primeng/avatar';
import { ChipModule } from 'primeng/chip';
import { MeterGroupModule, MeterItem } from 'primeng/metergroup';
import { RatingModule } from 'primeng/rating';
import { TeamStateService } from '../../services/team-state.service';
import { Player, Team } from '../../models/team.model';

const STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];

@Component({
  selector: 'app-team-display',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    TagModule,
    AvatarModule,
    ChipModule,
    MeterGroupModule,
    RatingModule,
  ],
  templateUrl: './team-display.component.html',
  styleUrl: './team-display.component.css',
})
export class TeamDisplayComponent {
  protected readonly teamState = inject(TeamStateService);

  protected readonly team = this.teamState.team;

  protected readonly starters = computed<Player[]>(() =>
    [...(this.team()?.players ?? [])]
      .filter((p) => p.starter)
      .sort((a, b) => STARTER_SLOT_ORDER.indexOf(a.slot) - STARTER_SLOT_ORDER.indexOf(b.slot)),
  );
  protected readonly bench = computed<Player[]>(() => (this.team()?.players ?? []).filter((p) => !p.starter));

  protected readonly startersProjectedTotal = computed(() =>
    this.starters().reduce((sum, p) => sum + p.projectedPoints, 0),
  );
  protected readonly startersPointsTotal = computed(() => this.starters().reduce((sum, p) => sum + p.points, 0));

  protected statusSeverity(status: string | null): 'success' | 'warn' | 'danger' {
    switch (status?.toUpperCase()) {
      case 'ACTIVE':
        return 'success';
      case 'QUESTIONABLE':
        return 'warn';
      default:
        return 'danger';
    }
  }

  protected formatGameTime(gameTimeUtc: string | null): string | null {
    if (!gameTimeUtc) {
      return null;
    }
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(gameTimeUtc));
  }

  // ESPN's "rank vs position" is 1 (toughest matchup for that position) to 32 (easiest); scaled
  // down to a 1-5 star rating where 1 star is a hard matchup and 5 stars is an easy one.
  protected matchupStars(rank: number | null): number {
    if (rank === null) return 0;
    return Math.min(5, Math.max(1, Math.ceil((rank / 32) * 5)));
  }

  protected recordMeterValues(t: Team): MeterItem[] {
    return [
      { label: 'W', value: t.wins, color: 'var(--p-green-500)' },
      { label: 'L', value: t.losses, color: 'var(--p-red-500)' },
      { label: 'T', value: t.ties, color: 'var(--p-surface-400)' },
    ];
  }

  protected recordMeterMax(t: Team): number {
    return t.wins + t.losses + t.ties || 1;
  }

  protected standingLabel(t: Team): string | null {
    if (!t.standingRank || !t.leagueSize) {
      return null;
    }
    return `${this.ordinal(t.standingRank)} of ${t.leagueSize}`;
  }

  private ordinal(n: number): string {
    const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
    const isTeens = n % 100 >= 11 && n % 100 <= 13;
    return `${n}${isTeens ? 'th' : (suffixes[n % 10] ?? 'th')}`;
  }
}
