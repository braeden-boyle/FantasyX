import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs';
import { AvatarModule } from 'primeng/avatar';
import { TeamLogoService } from '../../services/team-logo.service';

// A team's ESPN logo as a circular avatar, falling back to its abbreviation when there's no logo
// or it fails to load.
@Component({
  selector: 'app-team-logo',
  standalone: true,
  imports: [AvatarModule],
  template: `
    @if (src(); as s) {
      <p-avatar [image]="s" shape="circle" [size]="size()" (onImageError)="failed.set(true)" />
    } @else {
      <p-avatar [label]="abbrev() || '?'" shape="circle" [size]="size()" />
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
}
