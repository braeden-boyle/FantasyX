import { Injectable, computed, inject, signal } from '@angular/core';
import { LeagueOutlookService } from './league-outlook.service';
import { PlayerRankingsService } from './player-rankings.service';
import { ProjectionsService } from './projections.service';
import { StartSitService } from './start-sit.service';
import { TeamStateService } from './team-state.service';
import { Player } from '../models/team.model';
import { RankedPlayer, RankingHorizon } from '../utils/player-rankings';
import { isLocked } from '../utils/start-sit';
import {
  AvailableEntry,
  RosterEntry,
  WaiverAdvice,
  WaiverSuggestion,
  droppable,
  forPosition,
  proTeamLocked,
  rankSuggestions,
  waiverAdvice,
} from '../utils/waivers';

// loading     - the week, league, rankings or projections are still loading
// error       - the week failed to load (message in error)
// unavailable - the league's lineup settings or the rankings couldn't be built
// noAvailable - the available players failed to load, so there's nothing to suggest
// over        - the fantasy playoffs are over
// ready       - advice is built
export type WaiversStatus = 'idle' | 'loading' | 'error' | 'unavailable' | 'noAvailable' | 'over' | 'ready';

// A rostered player, and a free agent or waiver player, as the page shows them.
export interface WaiverRosterPlayer extends RosterEntry {
  player: Player;
}

export interface WaiverPickup extends AvailableEntry {
  player: RankedPlayer;
}

// Your waiver priority ("9th of 14"), or in a FAAB league your budget left. Either is null when
// ESPN doesn't send it. openSpots is null when the roster size isn't known.
export interface WaiverStanding {
  priority: { rank: number; teams: number } | null;
  budget: { left: number; total: number } | null;
  openSpots: number | null;
}

// Waiver advice for your own team (docs/PLAN.md, v1.13): the free agents and waiver players worth
// claiming, each with the drop that leaves your roster strongest over the rest of the season. Your
// roster comes from StartSitService's week, which the Advice page refetches on each visit, and the
// pool and every player's weekly projections from the rest-of-season player rankings. Only lazy pages
// inject it: the Waivers tab, and the Players page for its links to it.
@Injectable({ providedIn: 'root' })
export class WaiversService {
  private readonly teamState = inject(TeamStateService);
  private readonly startSit = inject(StartSitService);
  private readonly outlook = inject(LeagueOutlookService);
  private readonly projections = inject(ProjectionsService);
  private readonly rankingsService = inject(PlayerRankingsService);

  // Refetches the week (you may have just made a move on ESPN) and loads the rankings from the
  // session cache. On each visit.
  load(): void {
    this.startSit.refresh();
    this.rankingsService.ensureLoaded();
  }

  // Builds the advice from the cached week and rankings, if it isn't already (the Players page's
  // links, which shouldn't refetch anything).
  ensureLoaded(): void {
    this.startSit.ensureLoaded();
    this.rankingsService.ensureLoaded();
  }

  // Refetches the week and the available players, since other teams' claims change who's available.
  refresh(): void {
    this.startSit.refresh();
    this.rankingsService.refresh();
  }

  // Retry after a failure: the league again if its settings failed, and the week and available
  // players either way.
  retry(): void {
    if (this.outlook.error()) this.outlook.refresh();
    this.refresh();
  }

  // Whether each pickup is only paired with drops at its own position (a WR for a WR); on by
  // default. Kept for the session, so it survives switching tabs.
  readonly samePosition = signal(true);

  // What pickups are ranked by: this week's gain (the default), or their rest-of-season gain. Kept
  // for the session too.
  readonly horizon = signal<RankingHorizon>('week');

  readonly refreshing = computed(() => this.startSit.refreshing() || this.rankingsService.refreshing());
  readonly error = this.startSit.error;
  readonly scoringPeriod = this.startSit.scoringPeriod;
  readonly rankings = this.rankingsService.rankings;

  readonly status = computed<WaiversStatus>(() => {
    if (!this.teamState.importRequest()) return 'idle';
    if (this.startSit.error()) return 'error';
    if (this.outlook.error()) return 'unavailable';
    const league = this.outlook.league();
    if (league && !league.lineupSlots.length) return 'unavailable';
    const rankingsStatus = this.rankingsService.status();
    if (rankingsStatus === 'unavailable' || rankingsStatus === 'over') return rankingsStatus;
    if (rankingsStatus === 'loading' || !league || !this.startSit.side() || this.projections.status() === 'loading') {
      return 'loading';
    }
    return this.rankings()?.rosteredOnly ? 'noAvailable' : 'ready';
  });

  // Who's locked as of the clock: your players, and the available players whose game has kicked
  // off. Equal sets compare equal, so the advice only reruns when a lock flips, not every minute.
  private readonly locks = computed(
    () => {
      const now = this.startSit.now();
      const games = this.startSit.nflGames();
      const players = this.startSit.side()?.team.team.players ?? [];
      return {
        rostered: new Set(players.filter((p) => isLocked(p, now)).map((p) => p.playerId)),
        available: new Set(
          (this.rankings()?.players ?? [])
            .filter((p) => p.status !== 'ROSTERED' && proTeamLocked(p.proTeam, games, now))
            .map((p) => p.playerId),
        ),
      };
    },
    { equal: (a, b) => sameIds(a.rostered, b.rostered) && sameIds(a.available, b.available) },
  );

  // Your roster as waiver advice sees it. A player missing from the rankings (added since they
  // loaded, and outside the available pool) is projected from their own upcoming weeks.
  private readonly roster = computed<WaiverRosterPlayer[]>(() => {
    const side = this.startSit.side();
    const rankings = this.rankings();
    const league = this.outlook.league();
    if (!side || !rankings || !league) return [];
    const starting = new Set(rankings.positions);
    const future = this.projections.futureProjectionOf();
    const locked = this.locks().rostered;
    return side.team.team.players.map((p) => {
      const ranked = this.rankingsService.rankOf(p.playerId);
      const projections =
        ranked?.weeklyProjections ?? Object.fromEntries(this.weeks().map((w) => [w, future ? future(p, w) : 0]));
      return {
        playerId: p.playerId,
        position: p.position,
        projections,
        injuredReserve: p.slot === 'IR',
        droppable: droppable(p, starting, locked.has(p.playerId)),
        player: p,
      };
    });
  });

  // The rankings' window: this week through the last week of the fantasy playoffs.
  private readonly weeks = computed(() => {
    const rankings = this.rankings();
    if (!rankings) return [];
    return Array.from({ length: rankings.toWeek - rankings.fromWeek + 1 }, (_, i) => rankings.fromWeek + i);
  });

  private readonly pool = computed<WaiverPickup[]>(() => {
    const locked = this.locks().available;
    return (this.rankings()?.players ?? [])
      .filter((p) => p.status !== 'ROSTERED')
      .map((p) => ({
        playerId: p.playerId,
        position: p.position,
        projections: p.weeklyProjections,
        locked: locked.has(p.playerId),
        player: p,
      }));
  });

  readonly advice = computed<WaiverAdvice<WaiverRosterPlayer, WaiverPickup> | null>(() => {
    const league = this.outlook.league();
    if (this.status() !== 'ready' || !league) return null;
    return waiverAdvice({
      roster: this.roster(),
      available: this.pool(),
      slots: league.lineupSlots,
      weeks: this.weeks(),
      rosterSize: league.rosterSize,
      samePosition: this.samePosition(),
    });
  });

  // Each pickup the Waivers tab shows when filtered to its position, by player id, under the current
  // ranking and drop settings. Empty until the advice is ready.
  private readonly shownByPlayer = computed(() => {
    const suggestions = rankSuggestions(this.advice()?.suggestions ?? [], this.horizon());
    const positions = new Set(suggestions.map((s) => s.player.position));
    return new Map(
      [...positions].flatMap((position) => forPosition(suggestions, position).map((s) => [s.player.playerId, s] as const)),
    );
  });

  // A player's suggestion as the Waivers tab shows it, or undefined if it doesn't suggest them.
  suggestionFor(playerId: number): WaiverSuggestion<WaiverRosterPlayer, WaiverPickup> | undefined {
    return this.shownByPlayer().get(playerId);
  }

  // How many pickups would improve your roster, as the Waivers tab's summary counts them.
  readonly suggestionCount = computed(() => this.advice()?.suggestions.length ?? 0);

  readonly standing = computed<WaiverStanding | null>(() => {
    const league = this.outlook.league();
    const side = this.startSit.side();
    if (!league || !side) return null;
    const mine = league.standings.find((s) => s.teamId === side.team.team.teamId);
    const acquisition = league.acquisition;
    const offIr = side.team.team.players.filter((p) => p.slot !== 'IR').length;
    return {
      priority:
        !acquisition?.usesBudget && mine?.waiverRank ? { rank: mine.waiverRank, teams: league.standings.length } : null,
      budget:
        acquisition?.usesBudget
          ? { left: acquisition.budget - (mine?.budgetSpent ?? 0), total: acquisition.budget }
          : null,
      openSpots: league.rosterSize > 0 ? Math.max(0, league.rosterSize - offIr) : null,
    };
  });
}

function sameIds(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}
