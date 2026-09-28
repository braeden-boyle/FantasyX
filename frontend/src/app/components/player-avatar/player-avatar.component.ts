import { Component, computed, input } from '@angular/core';
import { AvatarModule } from 'primeng/avatar';
import { proTeamColors } from '../../utils/pro-team-colors';

// PrimeNG's avatar sizes, so badges line up with headshots in the same list.
const SIZES = { large: '3rem', xlarge: '4rem' } as const;

// A player's headshot, or for a D/ST a shield in the team's colours with its abbreviation, drawn
// here rather than using the team's logo.
@Component({
  selector: 'app-player-avatar',
  standalone: true,
  imports: [AvatarModule],
  template: `
    @if (player().isTeamLogo) {
      <svg
        viewBox="0 0 64 64"
        role="img"
        [attr.aria-label]="player().fullName + ' D/ST'"
        [style.width]="dimension()"
        [style.height]="dimension()"
      >
        <path
          d="M32 5 L55 13 V30 C55 45 45 55 32 59 C19 55 9 45 9 30 V13 Z"
          [attr.fill]="colors().primary"
          [attr.stroke]="colors().secondary"
          stroke-width="4"
          stroke-linejoin="round"
        />
        <text
          x="32"
          y="33"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="#FFFFFF"
          font-weight="700"
          [attr.font-size]="player().proTeam.length > 2 ? 15 : 18"
        >
          {{ player().proTeam }}
        </text>
      </svg>
    } @else {
      <p-avatar [image]="player().headshotUrl" shape="circle" [size]="size()" />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
  `,
})
export class PlayerAvatarComponent {
  // Satisfied by both Player (roster rows) and PlayerDetail (the drawer).
  readonly player = input.required<{ fullName: string; proTeam: string; headshotUrl: string; isTeamLogo: boolean }>();
  readonly size = input<keyof typeof SIZES>('xlarge');

  protected readonly dimension = computed(() => SIZES[this.size()]);
  protected readonly colors = computed(() => proTeamColors(this.player().proTeam));
}
