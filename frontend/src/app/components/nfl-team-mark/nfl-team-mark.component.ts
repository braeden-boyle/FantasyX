import { Component, computed, input } from '@angular/core';
import { proTeamColors } from '../../utils/pro-team-colors';

// An NFL team drawn in its colours instead of its logo: a dot in the primary colour ringed in the
// secondary (so dark teams still show on a dark background), or a larger badge with the abbreviation.
// Decorative: the abbreviation or name always sits beside it, or inside the badge.
@Component({
  selector: 'app-nfl-team-mark',
  standalone: true,
  template: `<span class="mark" [class.badge]="size() === 'badge'">
    @if (size() === 'badge') {
      {{ abbrev() }}
    }
  </span>`,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }

    .mark {
      display: inline-block;
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 999px;
      background: var(--primary);
      border: 2px solid var(--secondary);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--badge-size, 3rem);
      height: var(--badge-size, 3rem);
      border-width: 3px;
      color: #ffffff;
      font-weight: 700;
      font-size: calc(var(--badge-size, 3rem) * 0.3);
      letter-spacing: -0.02em;
    }
  `,
  host: {
    'aria-hidden': 'true',
    '[style.--primary]': 'colors().primary',
    '[style.--secondary]': 'colors().secondary',
  },
})
export class NflTeamMarkComponent {
  readonly abbrev = input.required<string>();
  readonly size = input<'dot' | 'badge'>('dot');

  protected readonly colors = computed(() => proTeamColors(this.abbrev()));
}
