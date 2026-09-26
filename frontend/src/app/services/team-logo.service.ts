import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';
import { TeamStateService } from './team-state.service';

// ESPN serves manager-uploaded logos from a host that 401s without the league's cookies, so those
// are fetched through the backend and shown via object URLs. Preset logos load directly.
const UPLOADED_LOGO_PREFIX = 'https://mystique-api.fantasy.espn.com/';

@Injectable({ providedIn: 'root' })
export class TeamLogoService {
  private readonly http = inject(HttpClient);
  private readonly teamState = inject(TeamStateService);
  private readonly logoUrl = `${environment.apiBaseUrl}/api/espn/logo`;

  // Session cache keyed by ESPN URL; the same logo shows in both matchups and standings.
  private readonly cache = new Map<string, Observable<string | null>>();

  // Emits a URL an <img> can load, or null when there's no usable logo.
  resolve(url: string | null): Observable<string | null> {
    if (!url) {
      return of(null);
    }
    if (!url.startsWith(UPLOADED_LOGO_PREFIX)) {
      return of(url);
    }

    let logo = this.cache.get(url);
    if (!logo) {
      const { espnS2, swid } = this.teamState.importRequest() ?? {};
      logo = this.http.post(this.logoUrl, { url, espnS2, swid }, { responseType: 'blob' }).pipe(
        map((blob) => URL.createObjectURL(blob)),
        // Failures aren't cached, so the logo is retried the next time it's shown.
        catchError(() => {
          this.cache.delete(url);
          return of(null);
        }),
        shareReplay(1),
      );
      this.cache.set(url, logo);
    }
    return logo;
  }
}
