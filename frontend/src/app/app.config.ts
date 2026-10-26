import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { routes } from './app.routes';
import { ImportRestoreService } from './services/import-restore.service';
import { DemoModeService } from './services/demo-mode.service';
import { demoInterceptor } from './services/demo.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Angular 21 defaults to zoneless; keep zone.js change detection for now.
    provideZoneChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    // The demo league's requests are answered from its fixtures.
    provideHttpClient(withInterceptors([demoInterceptor])),
    provideAnimationsAsync(),
    // Opens the demo from a ?demo link, or else picks up the demo or reloads the last imported team
    // after a refresh; none of them holds up startup.
    provideAppInitializer(() => {
      const demo = inject(DemoModeService);
      if (!demo.startFromLink() && !demo.resumeLast()) inject(ImportRestoreService).restore();
    }),
    providePrimeNG({
      theme: {
        preset: Aura,
      },
    }),
  ],
};
