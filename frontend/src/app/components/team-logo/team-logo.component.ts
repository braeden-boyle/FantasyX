import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs';
import { AvatarModule } from 'primeng/avatar';
import { TeamLogoService } from '../../services/team-logo.service';

// A team's ESPN logo as a circular avatar, falling back to its abbreviation (sized to fit) when
// there's no logo or it fails to load.
@Component({
  selector: 'app-team-logo',
  standalone: true,
  imports: [AvatarModule],
  template: `
    @if (src(); as s) {
      <p-avatar [image]="s" shape="circle" [size]="size()" (onImageError)="failed.set(true)" />
    } @else {
      <p-avatar
        [label]="label()"
        shape="circle"
        [size]="size()"
        [style.font-size.rem]="labelRem()"
        [style.overflow]="'hidden'"
      />
    }
  `,
})
export class TeamLogoComponent {
  private readonly teamLogos = inject(TeamLogoService);

  readonly logoUrl = input<string | null>(null);
  readonly abbrev = input<string>('');
  readonly size = input<'normal' | 'large' | 'xlarge'>('normal');

  protected readonly failed = signal(false);
  private readonly resolved = toSignal(
    toObservable(this.logoUrl).pipe(
      tap(() => this.failed.set(false)),
      switchMap((url) => this.teamLogos.resolve(url)),
    ),
    { initialValue: null },
  );
  protected readonly src = computed(() => (this.failed() ? null : this.resolved()));

  protected readonly label = computed(() => this.abbrev() || '?');
  // The abbreviation's font, shrunk to fit the circle: ESPN allows up to four characters, and four
  // at the avatar's own size (half its width) run well outside it.
  protected readonly labelRem = computed(() => {
    const length = this.label().length;
    const fit = length <= 2 ? 1 : length === 3 ? 0.68 : 0.5;
    return AVATAR_FONT_REM[this.size()] * fit;
  });
}

// PrimeNG's avatar font sizes, which are half the circle's width at each size.
const AVATAR_FONT_REM = { normal: 1, large: 1.5, xlarge: 2 } as const;
