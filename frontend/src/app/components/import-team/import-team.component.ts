import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { PanelModule } from 'primeng/panel';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { EspnApiService } from '../../services/espn-api.service';
import { TeamStateService } from '../../services/team-state.service';
import { DeviceIdService } from '../../services/device-id.service';
import { CredentialsApiService } from '../../services/credentials-api.service';
import { TeamSummary } from '../../models/team.model';

@Component({
  selector: 'app-import-team',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    PanelModule,
    ToggleSwitchModule,
    CheckboxModule,
    MessageModule,
  ],
  templateUrl: './import-team.component.html',
  styleUrl: './import-team.component.css',
})
export class ImportTeamComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);
  private readonly router = inject(Router);
  private readonly deviceId = inject(DeviceIdService);
  private readonly credentialsApi = inject(CredentialsApiService);

  protected readonly form = this.fb.group({
    leagueId: [null as number | null, Validators.required],
    season: [new Date().getFullYear(), Validators.required],
    isPrivate: [false],
    espnS2: [''],
    swid: [''],
    teamId: [null as number | null, Validators.required],
    rememberOnDevice: [false],
  });

  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly loadingTeams = signal(false);
  protected readonly importing = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly hasSavedDetails = signal(false);

  ngOnInit(): void {
    this.credentialsApi.get(this.deviceId.getDeviceId()).subscribe({
      next: (saved) => {
        this.hasSavedDetails.set(true);
        this.form.patchValue({
          espnS2: saved.espnS2,
          swid: saved.swid,
          isPrivate: true,
          rememberOnDevice: true,
          leagueId: saved.lastLeagueId,
          season: saved.lastSeason ?? new Date().getFullYear(),
        });

        if (saved.lastLeagueId && saved.lastSeason) {
          this.findTeams(saved.lastTeamId ?? undefined);
        }
      },
      error: () => {
        // No saved details for this device yet - leave the form at its defaults.
      },
    });
  }

  protected findTeams(preselectTeamId?: number): void {
    const { leagueId, season, isPrivate, espnS2, swid } = this.form.value;
    if (!leagueId || !season) {
      return;
    }
    this.errorMessage.set(null);
    this.loadingTeams.set(true);
    this.teams.set([]);
    this.espnApi
      .listTeams({
        leagueId,
        season,
        espnS2: isPrivate ? (espnS2 ?? undefined) : undefined,
        swid: isPrivate ? (swid ?? undefined) : undefined,
      })
      .subscribe({
        next: (teams) => {
          this.teams.set(teams);
          this.loadingTeams.set(false);
          if (preselectTeamId) {
            this.form.patchValue({ teamId: preselectTeamId });
          }
        },
        error: (err) => {
          this.errorMessage.set(err?.error?.title ?? 'Could not find teams for that league.');
          this.loadingTeams.set(false);
        },
      });
  }

  protected importTeam(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { leagueId, season, teamId, isPrivate, espnS2, swid, rememberOnDevice } = this.form.value;
    this.errorMessage.set(null);
    this.importing.set(true);
    this.espnApi
      .getTeam({
        leagueId: leagueId!,
        season: season!,
        teamId: teamId!,
        espnS2: isPrivate ? (espnS2 ?? undefined) : undefined,
        swid: isPrivate ? (swid ?? undefined) : undefined,
      })
      .subscribe({
        next: (team) => {
          this.importing.set(false);
          this.teamState.setTeam(team);

          if (rememberOnDevice && isPrivate && espnS2 && swid) {
            this.credentialsApi
              .save(this.deviceId.getDeviceId(), {
                espnS2,
                swid,
                lastLeagueId: leagueId ?? undefined,
                lastSeason: season ?? undefined,
                lastTeamId: teamId ?? undefined,
              })
              .subscribe();
          }

          this.router.navigateByUrl('/team');
        },
        error: (err) => {
          this.importing.set(false);
          this.errorMessage.set(err?.error?.title ?? 'Could not import that team.');
        },
      });
  }

  protected forgetSavedDetails(): void {
    this.credentialsApi.delete(this.deviceId.getDeviceId()).subscribe(() => {
      this.hasSavedDetails.set(false);
      this.form.reset({
        leagueId: null,
        season: new Date().getFullYear(),
        isPrivate: false,
        espnS2: '',
        swid: '',
        teamId: null,
        rememberOnDevice: false,
      });
      this.teams.set([]);
      this.errorMessage.set(null);
    });
  }
}
