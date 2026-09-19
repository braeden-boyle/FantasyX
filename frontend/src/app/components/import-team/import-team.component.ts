import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { PanelModule } from 'primeng/panel';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MessageModule } from 'primeng/message';
import { EspnApiService } from '../../services/espn-api.service';
import { TeamStateService } from '../../services/team-state.service';
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
    MessageModule,
  ],
  templateUrl: './import-team.component.html',
  styleUrl: './import-team.component.css',
})
export class ImportTeamComponent {
  private readonly fb = inject(FormBuilder);
  private readonly espnApi = inject(EspnApiService);
  private readonly teamState = inject(TeamStateService);
  private readonly router = inject(Router);

  protected readonly form = this.fb.group({
    leagueId: [null as number | null, Validators.required],
    season: [new Date().getFullYear(), Validators.required],
    isPrivate: [false],
    espnS2: [''],
    swid: [''],
    teamId: [null as number | null, Validators.required],
  });

  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly loadingTeams = signal(false);
  protected readonly importing = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected findTeams(): void {
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
        },
        error: (err) => {
          this.errorMessage.set(err?.error?.message ?? 'Could not find teams for that league.');
          this.loadingTeams.set(false);
        },
      });
  }

  protected importTeam(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { leagueId, season, teamId, isPrivate, espnS2, swid } = this.form.value;
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
          this.router.navigateByUrl('/team');
        },
        error: (err) => {
          this.importing.set(false);
          this.errorMessage.set(err?.error?.message ?? 'Could not import that team.');
        },
      });
  }
}
