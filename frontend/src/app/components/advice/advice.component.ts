import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';

// The Advice tab: one sub-tab per roster suggestion tool (docs/PLAN.md, Roster suggestions). Each
// tool fills in its tab when it ships; until then it's shown disabled.
@Component({
  selector: 'app-advice',
  standalone: true,
  imports: [RouterOutlet, TabsModule, TagModule],
  template: `
    <div class="max-w-4xl mx-auto mt-6 px-4">
      <p-tabs [value]="active()" (valueChange)="navigate($event)" [scrollable]="true">
        <p-tablist>
          @for (tool of tools; track tool.route) {
            <p-tab [value]="tool.route" [disabled]="!tool.ready" class="flex items-center !gap-2">
              <i [class]="tool.icon"></i>
              <span>{{ tool.label }}</span>
              @if (!tool.ready) {
                <!-- Dropped on phones, where the tab row is tight; the tab still reads as disabled. -->
                <span class="hidden sm:inline-flex"><p-tag value="Soon" severity="secondary" styleClass="!text-xs" /></span>
              }
            </p-tab>
          }
        </p-tablist>
      </p-tabs>
    </div>
    <router-outlet />
  `,
  styles: `
    :host {
      display: block;
    }

    /* The tab row sits on the page, like the header's. */
    :host ::ng-deep .p-tablist-tab-list {
      background: transparent;
    }
  `,
})
export class AdviceComponent {
  private readonly router = inject(Router);

  protected readonly tools = [
    { route: '/advice/start-sit', label: 'Start/Sit', icon: 'pi pi-sort-alt', ready: true },
    { route: '/advice/waivers', label: 'Waivers', icon: 'pi pi-user-plus', ready: false },
    { route: '/advice/trades', label: 'Trades', icon: 'pi pi-arrow-right-arrow-left', ready: false },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly active = computed(
    () => this.tools.find((t) => this.url().startsWith(t.route))?.route ?? this.tools[0].route,
  );

  protected navigate(route: string | number | undefined): void {
    if (typeof route === 'string' && route !== this.active()) this.router.navigateByUrl(route);
  }
}
