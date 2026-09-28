import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { EspnApiService } from './espn-api.service';
import { LastImport, TeamStateService } from './team-state.service';
import { CredentialsApiService } from './credentials-api.service';
import { DeviceIdService } from './device-id.service';
import { ImportTeamRequest } from '../models/team.model';

// Re-imports the last team on page load, so a refresh or a deep link keeps the user where they
// were instead of dropping back to "No team imported yet".
@Injectable({ providedIn: 'root' })
export class ImportRestoreService {
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);
  private readonly credentialsApi = inject(CredentialsApiService);
  private readonly deviceId = inject(DeviceIdService);

  // Starts the restore without blocking startup; teamState.restoring covers the wait.
  restore(): void {
    const last = this.teamState.lastImport();
    if (!last || this.teamState.team()) {
      return;
    }

    this.teamState.restoring.set(true);
    this.requestFor(last)
      .pipe(
        switchMap((request) =>
          request ? this.espnApi.getTeam(request).pipe(map((team) => ({ team, request }))) : of(null),
        ),
      )
      .subscribe({
        next: (restored) => {
          if (restored) this.teamState.setTeam(restored.team, restored.request);
          this.teamState.restoring.set(false);
        },
        error: (err) => {
          // Left on the last import, so the next load tries again (the error may be temporary).
          this.teamState.restoreError.set(err?.error?.title ?? 'Could not reload your team from ESPN.');
          this.teamState.restoring.set(false);
        },
      });
  }

  // A private league needs this device's saved cookies; without them (the user didn't tick
  // "Remember these details") there's nothing to restore with, and it quietly gives up.
  private requestFor(last: LastImport): Observable<ImportTeamRequest | null> {
    const { leagueId, season, teamId } = last;
    if (!last.isPrivate) {
      return of({ leagueId, season, teamId });
    }
    return this.credentialsApi.get(this.deviceId.getDeviceId()).pipe(
      map((saved) => ({ leagueId, season, teamId, espnS2: saved.espnS2, swid: saved.swid })),
      catchError(() => of(null)),
    );
  }
}
