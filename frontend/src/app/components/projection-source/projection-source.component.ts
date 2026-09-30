import { Component, inject } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { ProjectionsService } from '../../services/projections.service';

// Says which projections a view is showing whenever they aren't plain ESPN ones, so FantasyX
// figures are never mistaken for ESPN's (and ESPN's never shown under a FantasyX label).
@Component({
  selector: 'app-projection-source',
  standalone: true,
  imports: [TagModule],
  template: `
    @switch (projections.status()) {
      @case ('ready') {
        <p-tag severity="info" icon="pi pi-sparkles" value="FantasyX projections" styleClass="!text-xs" />
        @if (projections.multiWeek()) {
          <span class="text-xs text-surface-500">Team totals are ESPN's in multi-week rounds.</span>
        }
      }
      @case ('loading') {
        <span class="text-xs text-surface-500">Loading FantasyX projections…</span>
      }
      @case ('unavailable') {
        <span class="text-xs text-surface-500">
          <i class="pi pi-exclamation-circle text-xs"></i>
          FantasyX projections unavailable, showing ESPN's.
        </span>
      }
    }
  `,
  host: { class: 'inline-flex flex-wrap items-center gap-2' },
})
export class ProjectionSourceComponent {
  protected readonly projections = inject(ProjectionsService);
}
