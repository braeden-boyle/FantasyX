import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { Player } from '../../models/team.model';
import { TeamStateService } from '../../services/team-state.service';
import { TradeDraft, TradeRosterPlayer, TradesService } from '../../services/trades.service';
import { statusSeverity } from '../../utils/player-format';
import { formatOdds } from '../../utils/playoff-odds';
import { TradeOutcome, TradeSide } from '../../utils/trades';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { DrawerPlayer, PlayerDetailDrawerComponent } from '../player-detail-drawer/player-detail-drawer.component';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';
import { TeamLogoComponent } from '../team-logo/team-logo.component';

type SideKey = 'you' | 'them';

// The smallest gain shown as a number; anything closer to 0 reads "0.0".
const GAIN_SHOWN = 0.05;

// The Trades tab: pick a team and players each way, and see what the trade does to both sides.
@Component({
  selector: 'app-trades',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    MessageModule,
    ProgressSpinnerModule,
    SelectModule,
    SelectButtonModule,
    SkeletonModule,
    TagModule,
    TooltipModule,
    PlayerAvatarComponent,
    PlayerDetailDrawerComponent,
    ProjectionSourceComponent,
    TeamLogoComponent,
  ],
  templateUrl: './trades.component.html',
  styleUrl: './trades.component.css',
})
export class TradesComponent {
  protected readonly teamState = inject(TeamStateService);
  protected readonly trades = inject(TradesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  constructor() {
    // You may have just made a move on ESPN, so every visit refetches the week.
    this.trades.load();
    // The trade lives in the address, so it survives a reload and can be bookmarked.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => this.trades.trade.set(parseTrade(params)));
  }

  protected readonly trade = this.trades.trade;
  protected readonly analysis = this.trades.analysis;
  protected readonly statusSeverity = statusSeverity;
  protected readonly formatOdds = formatOdds;

  protected readonly partnerOptions = computed(() =>
    this.trades.partners().map((t) => {
      const standing = this.trades.standingOf(t.team.teamId);
      const wins = standing?.wins ?? t.team.wins;
      const losses = standing?.losses ?? t.team.losses;
      const ties = standing?.ties ?? t.team.ties;
      return {
        teamId: t.team.teamId,
        name: t.team.name,
        abbrev: t.team.abbrev,
        logoUrl: t.logoUrl,
        record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
      };
    }),
  );

  // Each roster in the order it's listed: by the league's starting positions, then rest-of-season
  // points; positions no slot takes (IDP) last.
  protected readonly myRoster = computed(() => this.ordered(this.trades.myRoster()));
  protected readonly partnerRoster = computed(() => this.ordered(this.trades.partnerRoster()));

  private ordered(roster: TradeRosterPlayer[]): TradeRosterPlayer[] {
    const positions = this.trades.rankings()?.positions ?? [];
    const order = (p: TradeRosterPlayer) => (p.pickable ? positions.indexOf(p.position) : positions.length);
    return [...roster].sort(
      (a, b) => order(a) - order(b) || (b.ranked?.restOfSeason ?? 0) - (a.ranked?.restOfSeason ?? 0) || a.playerId - b.playerId,
    );
  }

  // The players picked each way, as chips above the analysis.
  protected readonly picked = computed(() => {
    const { send, get } = this.trade();
    const pick = (roster: TradeRosterPlayer[], ids: number[]) =>
      ids.flatMap((id) => roster.filter((p) => p.playerId === id && p.pickable));
    return { send: pick(this.trades.myRoster(), send), get: pick(this.trades.partnerRoster(), get) };
  });

  protected isPicked(side: 'send' | 'get', playerId: number): boolean {
    return this.trade()[side].includes(playerId);
  }

  protected setPartner(partnerId: number | null): void {
    // Their players go with them; yours stay picked.
    this.navigate({ partnerId, send: this.trade().send, get: [] });
  }

  protected toggle(side: 'send' | 'get', player: TradeRosterPlayer): void {
    if (!player.pickable) return;
    const trade = this.trade();
    const ids = trade[side];
    const next = ids.includes(player.playerId) ? ids.filter((id) => id !== player.playerId) : [...ids, player.playerId];
    this.navigate({ ...trade, [side]: next });
  }

  protected remove(side: 'send' | 'get', playerId: number): void {
    const trade = this.trade();
    this.navigate({ ...trade, [side]: trade[side].filter((id) => id !== playerId) });
  }

  protected clear(): void {
    this.navigate({ partnerId: this.trade().partnerId, send: [], get: [] });
  }

  private navigate(trade: TradeDraft): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        team: trade.partnerId ?? null,
        send: trade.send.length ? trade.send.join(',') : null,
        get: trade.get.length ? trade.get.join(',') : null,
      },
      replaceUrl: true,
    });
  }

  // A player's projection in the trade's first week.
  protected nextWeek(player: TradeRosterPlayer): number {
    return player.projections[this.trades.weeks()[0]] ?? 0;
  }

  protected signed(gain: number): string {
    if (Math.abs(gain) < GAIN_SHOWN) return '0.0';
    return `${gain > 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)}`;
  }

  protected gainClass(gain: number): string {
    if (gain >= GAIN_SHOWN) return 'text-green-600 dark:text-green-400';
    if (gain <= -GAIN_SHOWN) return 'text-red-600 dark:text-red-400';
    return 'text-surface-500';
  }

  protected outcomeSeverity(outcome: TradeOutcome): 'success' | 'secondary' | 'danger' {
    return outcome === 'gains' ? 'success' : outcome === 'loses' ? 'danger' : 'secondary';
  }

  protected readonly outcomeLabels: Readonly<Record<TradeOutcome, string>> = {
    gains: 'Gains',
    even: 'About even',
    loses: 'Loses',
  };

  protected names(players: readonly TradeRosterPlayer[]): string {
    return players.map((p) => p.player.fullName).join(', ');
  }

  protected readonly partnerName = computed(() => this.trades.partner()?.team.name ?? 'They');
  protected readonly partnerId = computed(() => this.trades.partner()?.team.teamId ?? null);

  // Week by week: each side's gain per week as a bar up or down from the middle, scaled to the
  // largest week on either side, with the fantasy playoff weeks marked.
  protected readonly weekBars = computed(() => {
    const a = this.analysis();
    if (!a) return null;
    const playoffs = new Set(this.trades.rankings()?.playoffWeeks ?? []);
    const largest = Math.max(...[a.you, a.them].flatMap((s) => [...s.gainByWeek.values()].map(Math.abs)), GAIN_SHOWN);
    const bars = (side: TradeSide<TradeRosterPlayer>) =>
      a.weeks.map((week) => {
        const gain = side.gainByWeek.get(week) ?? 0;
        return { week, gain, height: (50 * Math.abs(gain)) / largest, up: gain >= 0, playoff: playoffs.has(week) };
      });
    return { you: bars(a.you), them: bars(a.them), hasPlayoffs: a.weeks.some((w) => playoffs.has(w)) };
  });

  protected readonly lineupSide = signal<SideKey>('you');
  protected readonly lineupOptions = computed(() => [
    { label: 'You', value: 'you' },
    { label: this.partnerName(), value: 'them' },
  ]);

  // Next week's best lineup for one side, slot by slot, before next to after. Both lineups list the
  // slots in the same fill order.
  protected readonly lineupRows = computed(() => {
    const a = this.analysis();
    if (!a) return null;
    const side = a[this.lineupSide()];
    const incoming = new Set(side.received.map((p) => p.playerId));
    const outgoing = new Set(side.sent.map((p) => p.playerId));
    const dropped = new Set(side.drops.map((p) => p.playerId));
    const mark = (playerId: number | undefined) =>
      playerId === undefined ? null
      : incoming.has(playerId) ? 'in'
      : outgoing.has(playerId) ? 'out'
      : dropped.has(playerId) ? 'drop'
      : null;
    return {
      before: side.lineupBefore.total,
      after: side.lineupAfter.total,
      rows: side.lineupBefore.starters.map((s, i) => {
        const before = s.player;
        const after = side.lineupAfter.starters[i]?.player ?? null;
        return {
          slot: s.slot.slot,
          before,
          after,
          beforeMark: mark(before?.playerId),
          afterMark: mark(after?.playerId),
          changed: before?.playerId !== after?.playerId,
        };
      }),
    };
  });

  protected readonly unpickableNote = "Roster value can't see this position, so they can't be traded here.";

  protected readonly markLabels: Readonly<Record<string, string>> = { in: 'In', out: 'Out', drop: 'Drop' };

  // The trade deadline as a short date ("Dec 2"). Intl rather than DatePipe, whose formatting code
  // would otherwise land in a chunk the initial bundle shares.
  protected readonly deadlineText = computed(() => {
    const deadline = this.trades.deadline();
    return deadline ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(deadline) : null;
  });

  protected readonly missingText = computed(() => {
    const count = this.trades.missing().length;
    if (!count) return null;
    return count === 1 ? '1 player picked is no longer on that roster.' : `${count} players picked are no longer on those rosters.`;
  });

  protected readonly selectedPlayer = signal<DrawerPlayer | null>(null);

  protected openPlayer(player: Player): void {
    this.selectedPlayer.set(player);
  }
}

// The trade in the address: /advice/trades?team=3&send=101,102&get=205. Anything unreadable is
// left out.
function parseTrade(params: ParamMap): TradeDraft {
  const ids = (value: string | null) =>
    (value ?? '')
      .split(',')
      .map(Number)
      .filter((id, i, all) => Number.isInteger(id) && id > 0 && all.indexOf(id) === i);
  const team = Number(params.get('team'));
  return { partnerId: Number.isInteger(team) && team > 0 ? team : null, send: ids(params.get('send')), get: ids(params.get('get')) };
}
