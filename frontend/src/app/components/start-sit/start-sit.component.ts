import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { StartSitService } from '../../services/start-sit.service';
import { TeamStateService } from '../../services/team-state.service';
import { Player } from '../../models/team.model';
import { AdvicePlayer, LineupWarning, TOSS_UP_PERCENT, Verdict } from '../../utils/start-sit';
import { formatChance } from '../../utils/win-probability';
import { formatGameTime, statusSeverity } from '../../utils/player-format';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { PlayerDetailDrawerComponent } from '../player-detail-drawer/player-detail-drawer.component';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';

// One row of the lineup list: a starting slot and who the advice puts there, or a bench player.
interface LineupRow {
  slot: string;
  player: AdvicePlayer | null;
  // Whether this player is coming into the lineup (a starter) or going out of it (bench).
  changed: boolean;
}

const VERDICT_SEVERITY: Record<Verdict, 'success' | 'secondary' | 'warn' | 'danger' | 'contrast'> = {
  Start: 'success',
  Sit: 'secondary',
  Locked: 'contrast',
  Bye: 'warn',
  Out: 'danger',
  IR: 'danger',
};

const WARNING_REASONS: Record<LineupWarning['reason'], string> = {
  bye: 'is on bye',
  out: 'is out',
  zero: 'is projected for 0',
};

// The Start/Sit tab: your set lineup against the best one your roster can field this week.
@Component({
  selector: 'app-start-sit',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    MessageModule,
    ProgressSpinnerModule,
    TableModule,
    TagModule,
    TooltipModule,
    PlayerAvatarComponent,
    PlayerDetailDrawerComponent,
    ProjectionSourceComponent,
  ],
  templateUrl: './start-sit.component.html',
  styleUrl: './start-sit.component.css',
})
export class StartSitComponent {
  protected readonly teamState = inject(TeamStateService);
  protected readonly startSit = inject(StartSitService);

  constructor() {
    // You may have just changed your lineup on ESPN, so every visit refetches the week.
    this.startSit.refresh();
    this.startSit.loadRanks();
  }

  protected readonly advice = this.startSit.advice;
  protected readonly winChange = this.startSit.winChange;

  protected readonly tossUpPercent = TOSS_UP_PERCENT;
  protected readonly statusSeverity = statusSeverity;
  protected readonly formatGameTime = formatGameTime;
  protected readonly warningReasons = WARNING_REASONS;

  protected verdictOf(player: AdvicePlayer | Player): Verdict | undefined {
    return this.advice()?.verdicts.get(player.playerId);
  }

  protected verdictSeverity(verdict: Verdict | undefined) {
    return verdict ? VERDICT_SEVERITY[verdict] : 'secondary';
  }

  protected percent(chance: number): string {
    return `${Math.round(chance * 100)}%`;
  }

  protected chance(probability: number): string {
    return formatChance(probability, false);
  }

  // The suggested lineup, slot by slot; a slot whose player is new to the lineup is marked.
  protected readonly starterRows = computed<LineupRow[]>(() => {
    const advice = this.advice();
    if (!advice) return [];
    const current = new Set(advice.current.starters.flatMap((s) => (s.player ? [s.player.playerId] : [])));
    return advice.best.starters.map((s) => ({
      slot: s.slot.slot,
      player: s.player,
      changed: !!s.player && !current.has(s.player.playerId),
    }));
  });

  // Everyone else: the bench (players going out of the lineup marked), then IR.
  protected readonly benchRows = computed<LineupRow[]>(() => {
    const advice = this.advice();
    const side = this.startSit.side();
    if (!advice || !side) return [];
    const current = new Set(advice.current.starters.flatMap((s) => (s.player ? [s.player.playerId] : [])));
    const bench = [...advice.best.bench]
      .sort((a, b) => b.projected - a.projected)
      .map((p) => ({ slot: 'BE', player: p, changed: current.has(p.playerId) }));
    const injuredReserve = side.team.team.players
      .filter((p) => p.slot === 'IR')
      .map((p) => ({ slot: 'IR', player: this.asAdvicePlayer(p), changed: false }));
    return [...bench, ...injuredReserve];
  });

  // An IR player isn't part of the advice; this shows them in the list with their ESPN projection.
  private asAdvicePlayer(p: Player): AdvicePlayer {
    return { playerId: p.playerId, position: p.position, projected: p.projectedPoints, slot: 'IR', locked: false, player: p, spread: 0 };
  }

  // The player detail drawer steps through the lineup list in the order it's shown.
  private readonly orderedPlayers = computed(() =>
    [...this.starterRows(), ...this.benchRows()].flatMap((r) => (r.player ? [r.player.player] : [])),
  );
  private readonly selectedPlayerId = signal<number | null>(null);
  private readonly selectedIndex = computed(() =>
    this.orderedPlayers().findIndex((p) => p.playerId === this.selectedPlayerId()),
  );
  protected readonly selectedPlayer = computed(() => this.orderedPlayers()[this.selectedIndex()] ?? null);
  protected readonly hasPreviousPlayer = computed(() => this.selectedIndex() > 0);
  protected readonly hasNextPlayer = computed(
    () => this.selectedIndex() >= 0 && this.selectedIndex() < this.orderedPlayers().length - 1,
  );

  protected openPlayer(player: Player): void {
    this.selectedPlayerId.set(player.playerId);
  }

  protected closePlayer(): void {
    this.selectedPlayerId.set(null);
  }

  protected stepPlayer(offset: number): void {
    const player = this.orderedPlayers()[this.selectedIndex() + offset];
    if (player) this.selectedPlayerId.set(player.playerId);
  }
}
