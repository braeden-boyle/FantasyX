import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectButtonModule } from 'primeng/selectbutton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { RatingModule } from 'primeng/rating';
import { TeamStateService } from '../../services/team-state.service';
import { LeagueOutlookService } from '../../services/league-outlook.service';
import { PlayerRankingsService } from '../../services/player-rankings.service';
import { ProjectionsService } from '../../services/projections.service';
import { Player, Standing } from '../../models/team.model';
import { REPLACEMENT_DEPTH, RankedPlayer, RankingHorizon } from '../../utils/player-rankings';
import { matchupStars, shortStatus, signed, statusLabel, statusSeverity } from '../../utils/player-format';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { TeamLogoComponent } from '../team-logo/team-logo.component';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';
import { DrawerPlayer, PlayerDetailDrawerComponent } from '../player-detail-drawer/player-detail-drawer.component';

type SortField =
  | 'rank'
  | 'name'
  | 'team'
  | 'value'
  | 'restOfSeason'
  | 'weekProjected'
  | 'weekPoints'
  | 'seasonAverage'
  | 'opponent'
  | 'matchup'
  | 'restOfSeasonSchedule'
  | 'playoffSchedule';
type Availability = 'all' | 'rostered' | 'available';

// Each column's first sort is the way that reads best: highest value first, but rank 1 first.
const DESCENDING_FIRST: ReadonlySet<SortField> = new Set([
  'value',
  'restOfSeason',
  'weekProjected',
  'weekPoints',
  'seasonAverage',
  // Easiest matchups and schedules first.
  'matchup',
  'restOfSeasonSchedule',
  'playoffSchedule',
]);

// Columns only one of the rankings shows. Switching away from one that's sorted goes back to rank.
const WEEK_ONLY: ReadonlySet<SortField> = new Set(['weekProjected', 'weekPoints', 'opponent', 'matchup']);
const REST_OF_SEASON_ONLY: ReadonlySet<SortField> = new Set(['restOfSeason', 'restOfSeasonSchedule', 'playoffSchedule']);

const PAGE_SIZE = 50;

// /players: FantasyX's ranking of every player in the league's pool, rostered or available, by
// rest-of-season value over replacement. Filters by position, availability and name; every column
// sorts. Rows open the player drawer, which steps through the rows as they're shown.
@Component({
  selector: 'app-player-rankings',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    RouterLink,
    TableModule,
    TagModule,
    SelectButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SkeletonModule,
    TooltipModule,
    RatingModule,
    PlayerAvatarComponent,
    TeamLogoComponent,
    ProjectionSourceComponent,
    PlayerDetailDrawerComponent,
  ],
  templateUrl: './player-rankings.component.html',
  styleUrl: './player-rankings.component.css',
})
export class PlayerRankingsComponent {
  protected readonly teamState = inject(TeamStateService);
  private readonly outlook = inject(LeagueOutlookService);
  private readonly projections = inject(ProjectionsService);
  private readonly playerRankings = inject(PlayerRankingsService);

  constructor() {
    this.playerRankings.ensureLoaded();
  }

  protected readonly status = this.playerRankings.status;
  // Rest of season by default; switches to this week's ranking.
  protected readonly horizon = signal<RankingHorizon>('restOfSeason');
  protected readonly horizonOptions: { label: string; value: RankingHorizon }[] = [
    { label: 'This Week', value: 'week' },
    { label: 'Rest of Season', value: 'restOfSeason' },
  ];
  protected readonly rankings = computed(() => this.playerRankings.rankingsFor(this.horizon()));
  protected readonly pageSize = PAGE_SIZE;
  protected readonly replacementDepth = REPLACEMENT_DEPTH;
  protected readonly placeholders = Array.from({ length: 10 }, (_, i) => i);

  // Filters.
  protected readonly position = signal('ALL');
  protected readonly availability = signal<Availability>('all');
  protected readonly search = signal('');
  protected readonly sort = signal<{ field: SortField; descending: boolean }>({ field: 'rank', descending: false });
  // The table's first row, back to the first page whenever the rows change.
  protected readonly first = signal(0);

  // The FLEX slot's positions, when the league has one.
  private readonly flexPositions = computed(
    () => this.outlook.league()?.lineupSlots.find((s) => s.slot === 'FLEX')?.eligiblePositions ?? null,
  );

  protected readonly positionOptions = computed(() => [
    { label: 'All', value: 'ALL' },
    ...(this.rankings()?.positions ?? []).map((p) => ({ label: p, value: p })),
    ...(this.flexPositions() ? [{ label: 'FLEX', value: 'FLEX' }] : []),
  ]);

  protected readonly availabilityOptions: { label: string; value: Availability }[] = [
    { label: 'All', value: 'all' },
    { label: 'Rostered', value: 'rostered' },
    { label: 'Available', value: 'available' },
  ];

  private readonly standingsById = computed(
    () => new Map((this.outlook.league()?.standings ?? []).map((s) => [s.teamId, s] as const)),
  );

  protected readonly rows = computed(() => {
    const players = this.rankings()?.players ?? [];
    const position = this.position();
    const flex = this.flexPositions();
    const availability = this.availability();
    const query = normalize(this.search().trim());
    const filtered = players.filter(
      (p) =>
        (position === 'ALL' || (position === 'FLEX' ? !!flex?.includes(p.position) : p.position === position)) &&
        (availability === 'all' || (availability === 'rostered') === (p.status === 'ROSTERED')) &&
        (!query || normalize(p.fullName).includes(query)),
    );
    const { field, descending } = this.sort();
    const compare = this.comparator(field);
    // Players with nothing in the column (no games yet, a bye, no ranked opponents left) sit below the
    // rest, whichever way it runs, and ties keep rank order.
    const missing = (p: RankedPlayer) => Number(sortValueMissing(field, p));
    return filtered.sort(
      (a, b) => missing(a) - missing(b) || (descending ? -compare(a, b) : compare(a, b)) || a.rank - b.rank,
    );
  });

  private comparator(field: SortField): (a: RankedPlayer, b: RankedPlayer) => number {
    switch (field) {
      case 'rank':
        return (a, b) => a.rank - b.rank;
      case 'name':
        return (a, b) => a.fullName.localeCompare(b.fullName);
      case 'team':
        return (a, b) => this.teamSortKey(a).localeCompare(this.teamSortKey(b));
      case 'value':
        return (a, b) => a.value - b.value;
      case 'restOfSeason':
        return (a, b) => a.restOfSeason - b.restOfSeason;
      case 'weekProjected':
        return (a, b) => a.weekProjected - b.weekProjected;
      case 'weekPoints':
        return (a, b) => a.weekPoints - b.weekPoints;
      case 'seasonAverage':
        return (a, b) => (a.seasonAverage ?? 0) - (b.seasonAverage ?? 0);
      case 'opponent':
        return (a, b) => (a.game?.opponent ?? '').localeCompare(b.game?.opponent ?? '');
      case 'matchup':
        return (a, b) => (a.game?.opponentPositionRank ?? 0) - (b.game?.opponentPositionRank ?? 0);
      case 'restOfSeasonSchedule':
        return (a, b) => (a.restOfSeasonSchedule ?? 0) - (b.restOfSeasonSchedule ?? 0);
      case 'playoffSchedule':
        return (a, b) => (a.playoffSchedule ?? 0) - (b.playoffSchedule ?? 0);
    }
  }

  // Rostered players by team abbreviation, then waiver players, then free agents.
  private teamSortKey(p: RankedPlayer): string {
    if (p.fantasyTeamId !== null) return `0${this.standingsById().get(p.fantasyTeamId)?.abbrev ?? ''}`;
    return p.status === 'WAIVERS' ? '1' : '2';
  }

  protected sortBy(field: SortField): void {
    const current = this.sort();
    this.sort.set({
      field,
      descending: current.field === field ? !current.descending : DESCENDING_FIRST.has(field),
    });
    this.first.set(0);
  }

  protected ariaSort(field: SortField): 'ascending' | 'descending' | 'none' {
    const { field: active, descending } = this.sort();
    return active !== field ? 'none' : descending ? 'descending' : 'ascending';
  }

  protected sortIcon(field: SortField): string {
    const { field: active, descending } = this.sort();
    if (active !== field) return 'pi pi-sort-alt sort-icon-idle';
    return descending ? 'pi pi-sort-amount-down' : 'pi pi-sort-amount-up-alt';
  }

  // This week's ranking shows this week's projection, points, opponent and matchup; the rest of the
  // season's, ROS points and strength of schedule instead.
  protected setHorizon(value: RankingHorizon | null): void {
    if (!value) return;
    this.horizon.set(value);
    const hidden = value === 'week' ? REST_OF_SEASON_ONLY : WEEK_ONLY;
    if (hidden.has(this.sort().field)) this.sort.set({ field: 'rank', descending: false });
    this.first.set(0);
  }

  // How many columns are showing, for the empty-table message.
  protected readonly columnCount = computed(() => {
    const r = this.rankings();
    return 5 + (r?.horizon === 'week' ? 4 : 2 + (r?.playoffWeeks.length ? 1 : 0));
  });

  // Opponent ranks (1 toughest to 32 easiest) show as stars, like the roster's matchups.
  protected readonly matchupStars = matchupStars;

  protected scheduleLabel(averageRank: number): string {
    return `Opponents' average rank against the position: ${averageRank.toFixed(1)} of 32 (1 is toughest).`;
  }

  // Filtered to one position (not All or FLEX), # counts within it: the WR1 is 1, whatever their
  // overall rank. A position's players share a replacement level, so the order is the same either way.
  protected readonly singlePosition = computed(() => !['ALL', 'FLEX'].includes(this.position()));

  protected rankShown(p: RankedPlayer): number {
    return this.singlePosition() ? p.positionRank : p.rank;
  }

  protected setPosition(value: string | null): void {
    if (value) {
      this.position.set(value);
      this.first.set(0);
    }
  }

  protected setAvailability(value: Availability | null): void {
    if (value) {
      this.availability.set(value);
      this.first.set(0);
    }
  }

  protected setSearch(value: string): void {
    this.search.set(value);
    this.first.set(0);
  }

  protected team(p: RankedPlayer): Standing | undefined {
    return p.fantasyTeamId === null ? undefined : this.standingsById().get(p.fantasyTeamId);
  }

  protected isMine(p: RankedPlayer): boolean {
    return p.fantasyTeamId !== null && p.fantasyTeamId === this.teamState.myTeamId();
  }

  protected readonly replacementLevels = computed(() =>
    [...(this.rankings()?.replacementLevels ?? new Map<string, number>())].map(([position, points]) => ({
      position,
      points,
    })),
  );

  protected readonly signed = signed;
  protected readonly shortStatus = shortStatus;
  protected readonly statusLabel = statusLabel;
  protected readonly statusSeverity = statusSeverity;

  // The drawer steps through the rows in the order they're shown, across pages.
  private readonly selectedPlayerId = signal<number | null>(null);
  private readonly selectedIndex = computed(() => this.rows().findIndex((p) => p.playerId === this.selectedPlayerId()));
  private readonly rosterPlayers = computed(
    () =>
      new Map(
        (this.projections.loadedHistory()?.week.teams ?? []).flatMap((t) =>
          t.team.players.map((p) => [p.playerId, p] as const),
        ),
      ),
  );
  // A rostered player opens with their roster row, which has this week's game; anyone else with
  // what the ranking has, and the drawer fills in the game once their detail loads.
  protected readonly selectedPlayer = computed<DrawerPlayer | null>(() => {
    const ranked = this.rows()[this.selectedIndex()];
    if (!ranked) return null;
    const rostered: Player | undefined = this.rosterPlayers().get(ranked.playerId);
    return rostered ?? ranked;
  });
  protected readonly hasPreviousPlayer = computed(() => this.selectedIndex() > 0);
  protected readonly hasNextPlayer = computed(
    () => this.selectedIndex() >= 0 && this.selectedIndex() < this.rows().length - 1,
  );

  protected openPlayer(player: RankedPlayer): void {
    this.selectedPlayerId.set(player.playerId);
  }

  protected closePlayer(): void {
    this.selectedPlayerId.set(null);
  }

  // Steps to the next or previous row, turning the table's page when it crosses one.
  protected stepPlayer(offset: number): void {
    const index = this.selectedIndex() + offset;
    const player = this.rows()[index];
    if (!player) return;
    this.selectedPlayerId.set(player.playerId);
    this.first.set(Math.floor(index / PAGE_SIZE) * PAGE_SIZE);
  }
}

function sortValueMissing(field: SortField, p: RankedPlayer): boolean {
  switch (field) {
    case 'seasonAverage':
      return p.seasonAverage === null;
    case 'opponent':
      return p.game === null;
    case 'matchup':
      return p.game?.opponentPositionRank == null;
    case 'restOfSeasonSchedule':
      return p.restOfSeasonSchedule === null;
    case 'playoffSchedule':
      return p.playoffSchedule === null;
    default:
      return false;
  }
}

// Lower case without accents, so "eric" finds "Éric".
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
