import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { routes } from './app.routes';
import { ImportRestoreService } from './services/import-restore.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // Angular 21 defaults to zoneless; keep zone.js change detection for now.
    provideZoneChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    provideAnimationsAsync(),
    // Reloads the last imported team after a refresh; doesn't hold up startup.
    provideAppInitializer(() => inject(ImportRestoreService).restore()),
    providePrimeNG({
      theme: {
        preset: Aura,
      },
    }),
  ],
};
