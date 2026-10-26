import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable, of, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { DemoScenario } from '../../models/demo.model';
import { ClockService } from '../../services/clock.service';
import { DemoModeService } from '../../services/demo-mode.service';
import { DEMO_SCENARIO_INFO } from '../../utils/demo';
import { formatGameTime } from '../../utils/player-format';

// How often the game clock is read again. The replay only steps once a minute, so this is just
// how soon after a step the clock and Skip ahead catch up.
const CLOCK_TICK_MS = 5 * 1000;

// The strip under the header while the demo league is on: the scenario switch, the team picker,
// the game-day replay's clock and controls, and the way out. Below desktop width, all but the
// label, the switch and the clock move into a popover; on phones the clock does too.
@Component({
  selector: 'app-demo-banner',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, ButtonModule, PopoverModule, SelectModule, SelectButtonModule],
  template: `
    <div class="demo-banner">
      <div class="max-w-6xl mx-auto px-4 py-1.5 flex items-center gap-2 sm:gap-3">
        <span id="demo-label" class="flex items-center gap-1.5 text-sm font-medium shrink-0">
          <i class="pi pi-eye" aria-hidden="true"></i>
          <span>Demo<span class="hidden sm:inline"> league</span></span>
        </span>
        <p-selectbutton
          class="shrink-0"
          [options]="scenarioOptions()"
          [ngModel]="demo.scenario()"
          (ngModelChange)="switchScenario($event)"
          [allowEmpty]="false"
          [disabled]="busy()"
          optionLabel="label"
          optionValue="value"
          optionDisabled="disabled"
          ariaLabelledBy="demo-label"
          size="small"
        />
        <!-- Between phone and desktop widths, only the clock fits beside the switch. -->
        @if (gameClock(); as clock) {
          <span class="hidden sm:inline lg:hidden text-sm tabular-nums text-surface-500 whitespace-nowrap">
            {{ clock }}{{ replayOver() ? ' · Final' : '' }}
          </span>
        }
        <div class="hidden lg:flex items-center gap-3 min-w-0">
          <ng-container *ngTemplateOutlet="controls" />
        </div>
        <div class="ml-auto flex items-center shrink-0">
          <p-button
            class="hidden lg:inline-flex"
            label="Import your own team"
            icon="pi pi-download"
            [text]="true"
            size="small"
            (onClick)="demo.exit()"
          />
          <p-button
            class="lg:hidden"
            icon="pi pi-ellipsis-h"
            [text]="true"
            [rounded]="true"
            size="small"
            ariaLabel="Demo options"
            (onClick)="popover.toggle($event)"
          />
        </div>
      </div>
      @if (error()) {
        <p class="max-w-6xl mx-auto px-4 pb-1.5 text-xs text-red-500" role="alert">{{ error() }}</p>
      }
    </div>

    <p-popover #popover ariaLabel="Demo options">
      <div class="flex flex-col gap-3 w-64 max-w-[calc(100vw-3rem)]">
        <ng-container *ngTemplateOutlet="controls" />
        <p-button label="Import your own team" icon="pi pi-download" [outlined]="true" size="small" (onClick)="demo.exit()" />
      </div>
    </p-popover>

    <ng-template #controls>
      <p-select
        [options]="teams()"
        [ngModel]="demo.teamId()"
        (ngModelChange)="switchTeam($event)"
        [disabled]="busy()"
        optionLabel="name"
        optionValue="teamId"
        ariaLabel="Your demo team"
        size="small"
        appendTo="body"
        styleClass="w-full lg:w-48"
      />
      @if (gameClock(); as clock) {
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-sm tabular-nums text-surface-500 whitespace-nowrap" aria-live="polite">
            {{ clock }}{{ replayOver() ? ' · Final' : '' }}
          </span>
          <p-button
            label="Skip ahead"
            icon="pi pi-forward"
            [text]="true"
            size="small"
            [disabled]="busy() || replayOver()"
            (onClick)="run(demo.skipAhead())"
          />
          <p-button
            label="Restart"
            icon="pi pi-replay"
            [text]="true"
            size="small"
            [disabled]="busy()"
            (onClick)="run(demo.restart())"
          />
        </div>
      }
    </ng-template>
  `,
  styles: `
    .demo-banner {
      background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
      border-bottom: 1px solid var(--p-content-border-color);
    }
  `,
})
export class DemoBannerComponent {
  protected readonly demo = inject(DemoModeService);
  private readonly clock = inject(ClockService);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly available = toSignal(this.demo.available(), { initialValue: [] as DemoScenario[] });
  protected readonly scenarioOptions = computed(() =>
    (['midweek', 'gameday'] as const).map((value) => ({
      value,
      label: DEMO_SCENARIO_INFO[value].label,
      disabled: !this.available().includes(value),
    })),
  );

  protected readonly teams = toSignal(
    toObservable(this.demo.scenario).pipe(switchMap((scenario) => (scenario ? this.demo.teams(scenario) : of([])))),
    { initialValue: [] },
  );

  private readonly ticks = signal(0);
  // The replay's time, on game day only, e.g. "Sun 2:40 PM".
  protected readonly gameClock = computed(() => {
    this.ticks();
    return this.demo.scenario() === 'gameday' ? formatGameTime(this.clock.now().toISOString()) : null;
  });
  protected readonly replayOver = computed(() => {
    this.ticks();
    return this.demo.nextStepIn() === null;
  });

  constructor() {
    const timer = setInterval(() => this.ticks.update((n) => n + 1), CLOCK_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  // Another scenario, as the same team.
  protected switchScenario(scenario: DemoScenario | null): void {
    if (scenario && scenario !== this.demo.scenario()) {
      this.run(this.demo.start(scenario, this.demo.teamId() ?? undefined));
    }
  }

  protected switchTeam(teamId: number | null): void {
    if (teamId !== null && teamId !== this.demo.teamId()) this.run(this.demo.switchTeam(teamId));
  }

  protected run(change: Observable<void>): void {
    this.busy.set(true);
    this.error.set(null);
    change.subscribe({
      next: () => {
        this.busy.set(false);
        this.ticks.update((n) => n + 1);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Could not load that part of the demo league. Try again in a moment.');
      },
    });
  }
}
