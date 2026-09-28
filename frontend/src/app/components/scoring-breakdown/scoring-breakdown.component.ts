import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PlayerGame } from '../../models/team.model';

// One game's points broken down by scoring stat; shown in the player drawer's popover and the
// matchup view's player modal.
@Component({
  selector: 'app-scoring-breakdown',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './scoring-breakdown.component.html',
  styleUrl: './scoring-breakdown.component.css',
})
export class ScoringBreakdownComponent {
  readonly game = input.required<PlayerGame>();
}
