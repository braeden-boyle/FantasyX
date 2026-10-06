import { Injectable, effect, signal } from '@angular/core';
import { ProjectionSource } from '../utils/projections';

export type { ProjectionSource } from '../utils/projections';

const SETTINGS_KEY = 'fantasyx.settings';

interface StoredSettings {
  projectionSource?: ProjectionSource;
}

// Per-device app settings, kept in localStorage like the last import. There are no accounts, so
// nothing goes server-side.
@Injectable({ providedIn: 'root' })
export class SettingsService {
  // Which projections every view shows. Default is ESPN's.
  readonly projectionSource = signal<ProjectionSource>(this.read().projectionSource === 'fantasyx' ? 'fantasyx' : 'espn');

  constructor() {
    effect(() => this.write({ projectionSource: this.projectionSource() }));
  }

  private read(): StoredSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored ? (JSON.parse(stored) as StoredSettings) : {};
    } catch {
      // localStorage unavailable or the entry is unreadable - use the defaults.
      return {};
    }
  }

  private write(settings: StoredSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // localStorage unavailable - the setting just won't survive a refresh.
    }
  }
}
