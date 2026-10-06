import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Chart } from 'chart.js';
import { DrawerModule } from 'primeng/drawer';
import { Popover, PopoverModule } from 'primeng/popover';
import { ChartModule } from 'primeng/chart';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { RatingModule } from 'primeng/rating';
import { TooltipModule } from 'primeng/tooltip';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { ScoringBreakdownComponent } from '../scoring-breakdown/scoring-breakdown.component';
import { PlayerDetailService } from '../../services/player-detail.service';
import { ProjectionsService } from '../../services/projections.service';
import { PlayerRankingsService } from '../../services/player-rankings.service';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';
import { Player, PlayerDetail, PlayerGame } from '../../models/team.model';
import { ordinal } from '../../utils/league-format';
import { formatGameDate, formatGameTime, matchupStars, signed, statusSeverity } from '../../utils/player-format';

// Below Tailwind's `lg` breakpoint the drawer always opens full screen.
const NARROW_QUERY = '(max-width: 1023.98px)';

// What the header shows while the detail loads: a roster row, with this week's game, or a player on
// no roster (from the Players page), without one until their detail arrives.
export type DrawerPlayer = Pick<
  Player,
  'playerId' | 'fullName' | 'position' | 'proTeam' | 'injuryStatus' | 'headshotUrl' | 'isTeamLogo'
> &
  Partial<Pick<Player, 'opponent' | 'opponentIsHome' | 'gameTimeUtc'>>;

@Component({
  selector: 'app-player-detail-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DrawerModule,
    PopoverModule,
    ChartModule,
    SkeletonModule,
    MessageModule,
    ButtonModule,
    TableModule,
    TagModule,
    RatingModule,
    TooltipModule,
    ScoringBreakdownComponent,
    PlayerAvatarComponent,
    ProjectionSourceComponent,
  ],
  templateUrl: './player-detail-drawer.component.html',
  styleUrl: './player-detail-drawer.component.css',
})
export class PlayerDetailDrawerComponent {
  private readonly playerDetail = inject(PlayerDetailService);
  private readonly projections = inject(ProjectionsService);
  protected readonly playerRankings = inject(PlayerRankingsService);

  // The row that was clicked; the header renders from it immediately while the detail loads.
  readonly player = input<DrawerPlayer | null>(null);
  readonly hasPrevious = input(false);
  readonly hasNext = input(false);

  readonly previous = output<void>();
  readonly next = output<void>();
  readonly closed = output<void>();

  protected readonly detail = signal<PlayerDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  // The past game whose scoring breakdown the popover is showing, if any.
  protected readonly breakdownGame = signal<PlayerGame | null>(null);
  protected readonly breakdownTitle = computed(() => {
    const game = this.breakdownGame();
    if (!game) return '';
    const opponent = game.opponent ? ` ${this.opponentLabel(game)}` : '';
    return `Week ${game.week}${opponent} scoring`;
  });
  private readonly breakdownPopover = viewChild.required(Popover);

  protected readonly maximized = signal(false);
  protected readonly narrow = signal(false);
  protected readonly fullScreen = computed(() => this.maximized() || this.narrow());

  protected readonly statusSeverity = statusSeverity;
  protected readonly formatGameTime = formatGameTime;
  protected readonly formatGameDate = formatGameDate;
  protected readonly matchupStars = matchupStars;

  protected readonly statColumns = computed(() => this.detail()?.statColumns ?? []);

  // This week's game for the header: from the row when it has one, otherwise from the detail once
  // it's loaded. Undefined until it's known; opponent is null on a bye.
  protected readonly thisWeek = computed(() => {
    const p = this.player();
    if (!p) return undefined;
    if (p.opponent !== undefined) {
      return { opponent: p.opponent, isHome: p.opponentIsHome ?? null, gameTimeUtc: p.gameTimeUtc ?? null };
    }
    const d = this.detail();
    if (d?.playerId !== p.playerId) return undefined;
    const game = d.games.find((g) => g.week === d.currentWeek && g.status !== 'Bye');
    return { opponent: game?.opponent ?? null, isHome: game?.isHome ?? null, gameTimeUtc: game?.gameTimeUtc ?? null };
  });

  // FantasyX's player ranking for the player, or undefined for one outside the pool.
  protected readonly ranking = computed(() => {
    const p = this.player();
    return p ? this.playerRankings.rankOf(p.playerId) : undefined;
  });
  protected readonly ordinal = ordinal;
  protected readonly signed = signed;

  protected readonly positionRankLabel = computed(() => {
    const d = this.detail();
    return d?.summary.positionRank ? `${d.position}${d.summary.positionRank}` : '—';
  });

  // A game's projection from the active source; past weeks show what FantasyX projected at the time.
  protected gameProjection(game: PlayerGame): number | null {
    const d = this.detail();
    return d ? this.projections.gameProjection(d, game) : game.projectedPoints;
  }

  // ESPN's total, or in FantasyX mode the sum of FantasyX's over the games left (summed the same way
  // the backend sums ESPN's). Null while FantasyX projections are loading.
  protected readonly restOfSeasonProjection = computed(() => {
    const d = this.detail();
    if (!d) return null;
    if (!this.projections.fantasyX()) {
      return this.projections.status() === 'loading' ? null : d.summary.restOfSeasonProjection;
    }
    return d.games
      .filter((g) => g.week >= d.currentWeek && g.status !== 'Bye')
      .reduce((sum, g) => sum + (this.projections.gameProjection(d, g) ?? 0), 0);
  });

  protected readonly chartData = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const projected = d.games.map((g) => this.projections.gameProjection(d, g));
    const style = getComputedStyle(document.documentElement);
    const hitColor = style.getPropertyValue('--p-primary-400');
    const missColor = style.getPropertyValue('--p-red-500');

    // Each week's bar is colored by whether actual points met the projection.
    const weekColors = d.games.map((g, i) => ((g.points ?? 0) >= (projected[i] ?? 0) ? hitColor : missColor));

    return {
      labels: d.games.map((g) => `W${g.week}`),
      datasets: [
        {
          type: 'bar',
          label: 'Points',
          data: d.games.map((g) => (g.status === 'Played' || g.status === 'DidNotPlay' ? g.points : null)),
          backgroundColor: weekColors,
          borderRadius: 4,
          order: 2,
        },
        {
          type: 'line',
          label: this.projections.fantasyX() ? 'FantasyX projected' : 'Projected',
          // Null on the bye week so the line breaks there instead of dipping to zero.
          data: d.games.map((g, i) => (g.status === 'Bye' ? null : projected[i])),
          borderColor: style.getPropertyValue('--p-surface-500'),
          borderDash: [4, 4],
          pointRadius: 2,
          tension: 0.3,
          fill: false,
          order: 1,
        },
      ],
    };
  });

  protected readonly chartOptions = {
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          // Point-style icons let Projected show as a line segment rather than a dashed box. Point
          // styles don't carry the dataset's dash pattern, so it's copied over to keep the segment
          // dotted like the line it stands for.
          usePointStyle: true,
          pointStyleWidth: 24,
          // The Points bars are colored per week, so the legend would otherwise show whichever color
          // week 1 happened to get; pin it to the "met projection" color instead.
          generateLabels: (chart: Chart) =>
            Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => {
              if (item.datasetIndex !== 0) {
                const dataset = chart.data.datasets[item.datasetIndex ?? 0] as { borderDash?: number[] };
                return { ...item, pointStyle: 'line' as const, lineDash: dataset.borderDash };
              }
              const hitColor = getComputedStyle(document.documentElement).getPropertyValue('--p-primary-400');
              return { ...item, fillStyle: hitColor, strokeStyle: hitColor, pointStyle: 'rect' as const };
            }),
        },
      },
      tooltip: {
        // Weeks without actual points (upcoming) or a projection (bye) still show up in an
        // index-mode tooltip, with a null value; leave those rows out.
        filter: (item: { parsed: { y: number | null } }) => item.parsed.y != null,
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
            `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1) ?? '—'}`,
        },
      },
    },
    scales: { y: { beginAtZero: true } },
  };

  private loadSubscription?: Subscription;

  constructor() {
    const media = window.matchMedia(NARROW_QUERY);
    this.narrow.set(media.matches);
    const onChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    media.addEventListener('change', onChange);
    // PrimeNG's drawer binds its own document-level Escape handler when it opens, so Escape would
    // close the drawer along with the popover; catching it in the window's capture phase, before
    // either component sees it, closes just the popover.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.breakdownGame()) {
        event.stopImmediatePropagation();
        this.breakdownPopover().hide();
      }
    };
    window.addEventListener('keydown', onEscape, true);

    inject(DestroyRef).onDestroy(() => {
      media.removeEventListener('change', onChange);
      window.removeEventListener('keydown', onEscape, true);
      this.loadSubscription?.unsubscribe();
    });

    effect(() => {
      const player = this.player();
      untracked(() => {
        if (!player) return this.reset();
        this.playerRankings.ensureLoaded();
        this.load(player.playerId);
      });
    });
  }

  protected refresh(): void {
    const player = this.player();
    if (player) this.load(player.playerId, true);
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.closed.emit();
  }

  // Arrow keys step through the roster while the drawer is open, unless focus is in a text field.
  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (!this.player()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (event.key === 'ArrowLeft' && this.hasPrevious()) {
      event.preventDefault();
      this.previous.emit();
    } else if (event.key === 'ArrowRight' && this.hasNext()) {
      event.preventDefault();
      this.next.emit();
    }
  }

  // Opens the popover on this game's points, moves it there from another game, or closes it if
  // it's already showing this game.
  protected toggleBreakdown(event: MouseEvent, game: PlayerGame): void {
    const popover = this.breakdownPopover();
    if (this.breakdownGame() === game) {
      popover.hide();
      return;
    }
    this.breakdownGame.set(game);
    popover.show(event, event.currentTarget);
  }

  protected opponentLabel(game: PlayerGame): string {
    return `${game.isHome ? 'vs' : '@'} ${game.opponent}`;
  }

  // The current week gets a divider above it, separating the game log from the upcoming schedule.
  protected isFirstCurrentRow(game: PlayerGame): boolean {
    const detail = this.detail();
    return !!detail && game.week === detail.currentWeek && detail.games[0]?.week !== game.week;
  }

  private load(playerId: number, force = false): void {
    this.loadSubscription?.unsubscribe();
    this.error.set(null);
    this.loading.set(true);
    if (this.detail()?.playerId !== playerId) {
      this.detail.set(null);
      this.breakdownPopover().hide();
    }

    this.loadSubscription = this.playerDetail.load(playerId, force).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.title ?? 'Could not load player details.');
        this.loading.set(false);
      },
    });
  }

  private reset(): void {
    this.loadSubscription?.unsubscribe();
    this.detail.set(null);
    this.error.set(null);
    this.loading.set(false);
  }
}
