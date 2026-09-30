import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SkeletonModule } from 'primeng/skeleton';
import { ProjectionSource, SettingsService } from '../../services/settings.service';
import { ProjectionsService } from '../../services/projections.service';
import { USE_RANK_TERM } from '../../utils/projections';

// The header's gear button: a popover with the ESPN / FantasyX projections switch and the backtest
// behind it, so the choice is an informed one.
@Component({
  selector: 'app-settings-menu',
  standalone: true,
  imports: [DecimalPipe, FormsModule, ButtonModule, PopoverModule, SelectButtonModule, SkeletonModule],
  template: `
    <p-button
      icon="pi pi-cog"
      [text]="true"
      [rounded]="true"
      size="small"
      ariaLabel="Settings"
      (onClick)="open($event, popover)"
    />
    <p-popover #popover ariaLabel="Settings">
      <div class="flex flex-col gap-3 w-72 max-w-[calc(100vw-3rem)]">
        <div class="flex flex-col gap-1.5">
          <span id="projections-setting" class="text-sm font-medium">Projections</span>
          <p-selectbutton
            [options]="sourceOptions"
            [ngModel]="settings.projectionSource()"
            (ngModelChange)="setSource($event)"
            [allowEmpty]="false"
            optionLabel="label"
            optionValue="value"
            ariaLabelledBy="projections-setting"
            size="small"
          />
          <p class="text-xs text-surface-500">
            FantasyX adjusts ESPN's projection by how far off ESPN has been for each player this season.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">Backtest this season</span>
          @switch (projections.historyStatus()) {
            @case ('ready') {
              @if (backtest(); as b) {
                @if (b.playerWeeks) {
                  <table class="backtest text-xs tabular-nums w-full">
                    <thead>
                      <tr class="text-surface-500">
                        <th class="text-left font-normal">Source</th>
                        <th class="text-right font-normal">Avg miss</th>
                        <th class="text-right font-normal">RMSE</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of rows(); track row.label) {
                        <tr [class.font-semibold]="row.best">
                          <td>{{ row.label }}</td>
                          <td class="text-right">{{ row.mae | number: '1.2-2' }}</td>
                          <td class="text-right">{{ row.rmse | number: '1.2-2' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                  <p class="text-xs text-surface-500">
                    {{ b.playerWeeks }} rostered player-weeks, each projected from earlier weeks only. Lower is better.
                    The rank row uses opponents' current defensive ranks, so it looks better than it would have at the time.
                  </p>
                } @else {
                  <p class="text-xs text-surface-500">No games played yet this season.</p>
                }
              }
            }
            @case ('failed') {
              <p class="text-xs text-surface-500">Couldn't load player history for the backtest.</p>
            }
            @default {
              <p-skeleton height="4.5rem" />
            }
          }
        </div>
      </div>
    </p-popover>
  `,
  styles: `
    .backtest td,
    .backtest th {
      padding: 0.2rem 0;
    }
  `,
})
export class SettingsMenuComponent {
  protected readonly settings = inject(SettingsService);
  protected readonly projections = inject(ProjectionsService);

  protected readonly sourceOptions: { label: string; value: ProjectionSource }[] = [
    { label: 'ESPN', value: 'espn' },
    { label: 'FantasyX', value: 'fantasyx' },
  ];

  protected readonly backtest = this.projections.backtest;

  protected readonly rows = computed(() => {
    const b = this.backtest();
    if (!b) return [];
    const rows = [
      { label: 'ESPN', ...b.espn },
      { label: USE_RANK_TERM ? 'FantasyX, bias only' : 'FantasyX', ...b.bias },
      { label: USE_RANK_TERM ? 'FantasyX' : 'FantasyX + opponent rank', ...b.biasRank },
    ];
    const best = Math.min(...rows.map((r) => r.mae));
    return rows.map((r) => ({ ...r, best: r.mae === best }));
  });

  protected open(event: Event, popover: { toggle(event: Event): void }): void {
    // The backtest needs player history, even while ESPN projections are showing.
    this.projections.ensureLoaded();
    popover.toggle(event);
  }

  protected setSource(source: ProjectionSource | null): void {
    if (source) this.settings.projectionSource.set(source);
  }
}
