import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TeamStateService } from '../../services/team-state.service';
import { WaiversService } from '../../services/waivers.service';
import { ordinal } from '../../utils/league-format';
import { statusSeverity } from '../../utils/player-format';
import { MIN_GAIN, forPosition } from '../../utils/waivers';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { DrawerPlayer, PlayerDetailDrawerComponent } from '../player-detail-drawer/player-detail-drawer.component';
import { ProjectionSourceComponent } from '../projection-source/projection-source.component';

const ALL = 'ALL';

// The Waivers tab: free agents and waiver players worth claiming, and who to drop for each.
@Component({
  selector: 'app-waivers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    MessageModule,
    ProgressSpinnerModule,
    SelectButtonModule,
    TagModule,
    TooltipModule,
    PlayerAvatarComponent,
    PlayerDetailDrawerComponent,
    ProjectionSourceComponent,
  ],
  templateUrl: './waivers.component.html',
  styleUrl: './waivers.component.css',
})
export class WaiversComponent {
  protected readonly teamState = inject(TeamStateService);
  protected readonly waivers = inject(WaiversService);

  constructor() {
    // You may have just made a move on ESPN, so every visit refetches the week.
    this.waivers.load();
  }

  protected readonly advice = this.waivers.advice;
  protected readonly standing = this.waivers.standing;
  protected readonly ordinal = ordinal;
  protected readonly statusSeverity = statusSeverity;
  protected readonly minGain = MIN_GAIN;

  protected readonly position = signal(ALL);
  protected readonly positionOptions = computed(() => [
    { label: 'All', value: ALL },
    ...(this.waivers.rankings()?.positions ?? []).map((p) => ({ label: p, value: p })),
  ]);

  protected readonly suggestions = computed(() => {
    const position = this.position();
    return forPosition(this.advice()?.suggestions ?? [], position === ALL ? null : position);
  });

  // The rankings' window, for "Starts 8 of 11 weeks".
  protected readonly windowWeeks = computed(() => {
    const rankings = this.waivers.rankings();
    return rankings ? rankings.toWeek - rankings.fromWeek + 1 : 0;
  });

  protected setPosition(position: string | null): void {
    this.position.set(position ?? ALL);
  }

  // The player detail drawer steps through the pickups and drops in the order they're shown.
  private readonly orderedPlayers = computed<DrawerPlayer[]>(() =>
    this.suggestions().flatMap((s) => [
      s.player.player,
      ...(s.drop ? [s.drop.player] : []),
      ...(s.alternative ? [s.alternative.drop.player] : []),
    ]),
  );
  // A position in that order rather than a player id, since a player can show up more than once
  // (one drop for several pickups).
  private readonly selectedIndex = signal<number | null>(null);
  protected readonly selectedPlayer = computed(() => {
    const index = this.selectedIndex();
    return index === null ? null : (this.orderedPlayers()[index] ?? null);
  });
  protected readonly hasPreviousPlayer = computed(() => (this.selectedIndex() ?? 0) > 0);
  protected readonly hasNextPlayer = computed(() => {
    const index = this.selectedIndex();
    return index !== null && index < this.orderedPlayers().length - 1;
  });

  // Opens the drawer on a player in one pickup's card: the first entry for them from that card on.
  protected openPlayer(player: DrawerPlayer, pickupIndex: number): void {
    const players = this.orderedPlayers();
    const start = players.indexOf(this.suggestions()[pickupIndex].player.player);
    this.selectedIndex.set(players.findIndex((p, i) => i >= start && p.playerId === player.playerId));
  }

  protected closePlayer(): void {
    this.selectedIndex.set(null);
  }

  protected stepPlayer(offset: number): void {
    const index = (this.selectedIndex() ?? 0) + offset;
    if (this.orderedPlayers()[index]) this.selectedIndex.set(index);
  }
}
