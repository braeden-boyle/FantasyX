import { Component, OnInit, computed, inject, linkedSignal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, of, switchMap } from 'rxjs';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { PanelModule } from 'primeng/panel';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { SelectButtonModule } from 'primeng/selectbutton';
import { DemoScenario } from '../../models/demo.model';
import { DemoModeService } from '../../services/demo-mode.service';
import { DEMO_SCENARIO_INFO } from '../../utils/demo';
import { EspnApiService } from '../../services/espn-api.service';
import { TeamStateService } from '../../services/team-state.service';
import { DeviceIdService } from '../../services/device-id.service';
import { CredentialsApiService } from '../../services/credentials-api.service';
import { ImportTeamRequest, TeamSummary } from '../../models/team.model';

@Component({
  selector: 'app-import-team',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    SelectButtonModule,
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
  protected readonly teamState = inject(TeamStateService);
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

  // The Try the demo card: shown once there's a scenario to show, starting on the one the visitor
  // is already in, if any, as the team they already are.
  private readonly demo = inject(DemoModeService);
  private readonly demoScenarios = toSignal(this.demo.available(), { initialValue: [] as DemoScenario[] });
  protected readonly demoScenarioOptions = computed(() =>
    (['midweek', 'gameday'] as const).map((value) => ({
      value,
      label: DEMO_SCENARIO_INFO[value].label,
      disabled: !this.demoScenarios().includes(value),
    })),
  );
  protected readonly demoScenario = linkedSignal<DemoScenario | null>(() => this.demo.scenario() ?? this.demoScenarios()[0] ?? null);
  protected readonly demoDescription = computed(() => {
    const scenario = this.demoScenario();
    return scenario ? DEMO_SCENARIO_INFO[scenario].description : null;
  });
  private readonly demoLeague = toSignal(
    toObservable(this.demoScenario).pipe(
      switchMap((scenario) =>
        scenario ? forkJoin({ teams: this.demo.teams(scenario), manifest: this.demo.manifest(scenario) }) : of(null),
      ),
    ),
    { initialValue: null },
  );
  protected readonly demoTeams = computed(() => this.demoLeague()?.teams ?? []);
  protected readonly demoTeamId = linkedSignal(() => this.demo.teamId() ?? this.demoLeague()?.manifest.defaultTeamId ?? null);
  // What the demo shows, with the icons of the tabs they're on.
  protected readonly demoFeatures = [
    { icon: 'pi pi-bolt', label: 'Live scores & win odds' },
    { icon: 'pi pi-lightbulb', label: 'Start/sit, waivers & trades' },
    { icon: 'pi pi-trophy', label: 'Power rankings & playoff odds' },
    { icon: 'pi pi-users', label: 'Player rankings' },
  ];
  protected readonly startingDemo = signal(false);
  protected readonly demoError = signal<string | null>(null);

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
    const request: ImportTeamRequest = {
      leagueId: leagueId!,
      season: season!,
      teamId: teamId!,
      espnS2: isPrivate ? (espnS2 ?? undefined) : undefined,
      swid: isPrivate ? (swid ?? undefined) : undefined,
    };
    this.espnApi
      .getTeam(request)
      .subscribe({
        next: (team) => {
          this.importing.set(false);
          this.teamState.setTeam(team, request);

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

  protected startDemo(): void {
    const scenario = this.demoScenario();
    if (!scenario) return;
    this.demoError.set(null);
    this.startingDemo.set(true);
    this.demo.start(scenario, this.demoTeamId() ?? undefined).subscribe({
      next: () => {
        this.startingDemo.set(false);
        this.router.navigateByUrl('/team');
      },
      error: () => {
        this.startingDemo.set(false);
        this.demoError.set('Could not load the demo league.');
      },
    });
  }

  protected forgetSavedDetails(): void {
    this.credentialsApi.delete(this.deviceId.getDeviceId()).subscribe(() => {
      this.teamState.forgetLastImport();
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
