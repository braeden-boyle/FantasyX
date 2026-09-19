import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TeamStateService } from '../../services/team-state.service';
import { Player } from '../../models/team.model';

@Component({
  selector: 'app-team-display',
  standalone: true,
  imports: [CommonModule, RouterLink, TableModule, TagModule],
  templateUrl: './team-display.component.html',
  styleUrl: './team-display.component.css',
})
export class TeamDisplayComponent {
  protected readonly teamState = inject(TeamStateService);

  protected readonly team = this.teamState.team;

  protected readonly starters = computed<Player[]>(() => (this.team()?.players ?? []).filter((p) => p.starter));
  protected readonly bench = computed<Player[]>(() => (this.team()?.players ?? []).filter((p) => !p.starter));
}
