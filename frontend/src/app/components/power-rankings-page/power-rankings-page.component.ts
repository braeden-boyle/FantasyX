import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { LeagueOutlookService } from '../../services/league-outlook.service';
import { TeamStateService } from '../../services/team-state.service';
import { PowerRankingsComponent } from '../power-rankings/power-rankings.component';

// /league/rankings: the power rankings on their own page, for screens too narrow to show them
// beside the standings. Reuses the session's league if it's already loaded.
@Component({
  selector: 'app-power-rankings-page',
  standalone: true,
  imports: [RouterLink, ProgressSpinnerModule, MessageModule, ButtonModule, PowerRankingsComponent],
  template: `
    @if (!teamState.importRequest()) {
      <div class="max-w-xl mx-auto mt-10 p-4 text-center text-surface-500">
        No team imported yet. <a routerLink="/import" class="text-primary-600 underline">Go import one</a>.
      </div>
    } @else {
      <div class="max-w-xl mx-auto mt-10 p-4 flex flex-col gap-4">
        <a routerLink="/league" class="text-primary-600 underline text-sm w-fit">
          <i class="pi pi-arrow-left text-xs"></i> Back to League
        </a>
        @if (outlook.loading()) {
          <div class="flex justify-center mt-6">
            <p-progress-spinner ariaLabel="Loading league" />
          </div>
        } @else if (outlook.error()) {
          <div class="flex flex-col items-start gap-3">
            <p-message severity="error" [text]="outlook.error()!" class="w-full" />
            <p-button label="Retry" icon="pi pi-refresh" size="small" (onClick)="outlook.refresh()" />
          </div>
        } @else {
          <app-power-rankings />
        }
      </div>
    }
  `,
})
export class PowerRankingsPageComponent {
  protected readonly teamState = inject(TeamStateService);
  protected readonly outlook = inject(LeagueOutlookService);

  constructor() {
    this.outlook.ensureLoaded();
  }
}
