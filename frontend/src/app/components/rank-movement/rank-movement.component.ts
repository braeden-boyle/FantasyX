import { Component, computed, input } from '@angular/core';

// A power rank's movement since last week: a green up arrow with the places climbed, a red down
// arrow with the places fallen, or a dash for no change. Nothing at all without an earlier ranking
// to compare with.
@Component({
  selector: 'app-rank-movement',
  standalone: true,
  template: `
    @if (movement(); as m) {
      <span class="sr-only">{{ label() }}</span>
      <span [class]="m > 0 ? 'movement-up' : 'movement-down'" aria-hidden="true">
        <i [class]="m > 0 ? 'pi pi-caret-up' : 'pi pi-caret-down'"></i>{{ m > 0 ? m : -m }}
      </span>
    } @else if (movement() === 0) {
      <span class="sr-only">{{ label() }}</span>
      <span class="movement-none" aria-hidden="true">–</span>
    }
  `,
  styles: `
    :host {
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pi {
      font-size: 0.75rem;
    }
    .movement-up {
      color: var(--p-green-600);
    }
    .movement-down {
      color: var(--p-red-600);
    }
    .movement-none {
      color: var(--p-text-muted-color);
    }
  `,
})
export class RankMovementComponent {
  readonly movement = input<number | null>(null);
  // What the movement is measured against, for screen readers.
  readonly period = input('since last week');

  protected readonly label = computed(() => {
    const m = this.movement() ?? 0;
    if (m > 0) return `Up ${m} ${this.period()}`;
    if (m < 0) return `Down ${-m} ${this.period()}`;
    return `No change ${this.period()}`;
  });
}
