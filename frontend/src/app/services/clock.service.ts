import { Injectable, inject } from '@angular/core';
import { DemoModeService } from './demo-mode.service';

// The one source of the current time, so the demo league can run on its own clock: game phases,
// lineup locks, the trade deadline and live refreshes are all judged against it. Outside the demo
// it's the real time.
@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly demo = inject(DemoModeService);

  now(): Date {
    return this.demo.now() ?? new Date();
  }

  // How long to wait, in real time, for a refresh due `delay` from now on this clock.
  refreshDelay(delay: number): number {
    return this.demo.refreshDelay(delay) ?? delay;
  }
}
