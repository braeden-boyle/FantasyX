import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, map, of, startWith, switchMap } from 'rxjs';
import { LeagueOutlookService } from './league-outlook.service';
import { PlayerRankingsService } from './player-rankings.service';
import { ProjectionsService } from './projections.service';
import { StartSitService } from './start-sit.service';
import { TeamStateService } from './team-state.service';
import { MatchupTeam, Player, Standing } from '../models/team.model';
import { PlayoffOdds, TeamOdds } from '../utils/playoff-odds';
import { RankedPlayer } from '../utils/player-rankings';
import { TradeAnalysis, TradeSide, missingPicks, tradeAnalysis, tradeWeeks } from '../utils/trades';
import { RosterEntry } from '../utils/waivers';

// How long the picks have to settle before the odds are rerun, so ticking players doesn't start a
// simulation per click.
const ODDS_DEBOUNCE_MS = 300;

// loading     - the week, league, rankings or projections are still loading
// error       - the week failed to load (message in error)
// unavailable - the league's lineup settings or the rankings couldn't be built
// over        - there's no week left after this one for a trade to count in
// ready       - the rosters are ready to trade from
export type TradesStatus = 'idle' | 'loading' | 'error' | 'unavailable' | 'over' | 'ready';

// The trade as the address has it: the partner (null until one is picked) and the player ids each
// way.
export interface TradeDraft {
  partnerId: number | null;
  send: number[];
  get: number[];
}

// A rostered player as the analyzer sees them. pickable is false at a position no starting slot
// takes (IDP), which roster value can't see. ranked is their rest-of-season ranking, when they have
// one.
export interface TradeRosterPlayer extends RosterEntry {
  player: Player;
  ranked: RankedPlayer | undefined;
  pickable: boolean;
}

export interface OddsChange {
  before: TeamOdds;
  after: TeamOdds;
}

// Both teams' playoff odds before and after the trade, while the rerun is under way or once it's
// done. byes is false in a league without first-round byes.
export type TradeOddsView = { status: 'loading' } | { status: 'ready'; you: OddsChange; them: OddsChange; byes: boolean };

// The trade analyzer (docs/PLAN.md, v1.14): a trade between your team and one other, judged for both
// sides over next week through the end of the fantasy playoffs. Both rosters come from
// StartSitService's week, which the page refetches on each visit, and every player's weekly
// projections from the rest-of-season rankings. Only the lazy Trades tab injects it.
@Injectable({ providedIn: 'root' })
export class TradesService {
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

  // Refetches the week. The rankings only matter for projections, so they stay cached.
  refresh(): void {
    this.startSit.refresh();
  }

  // Retry after a failure: the league again if its settings failed, and the week either way.
  retry(): void {
    if (this.outlook.error()) this.outlook.refresh();
    this.refresh();
  }

  // Set by the page from the address.
  readonly trade = signal<TradeDraft>({ partnerId: null, send: [], get: [] });

  readonly refreshing = this.startSit.refreshing;
  readonly error = this.startSit.error;
  readonly scoringPeriod = this.startSit.scoringPeriod;
  readonly rankings = this.rankingsService.rankings;

  // The weeks a trade counts in: next week through the last week of the fantasy playoffs.
  readonly weeks = computed(() => {
    const rankings = this.rankings();
    return rankings ? tradeWeeks(rankings.fromWeek, rankings.toWeek) : [];
  });

  // The rankings' window, this week included, for players the rankings don't cover.
  private readonly rankingWeeks = computed(() => {
    const rankings = this.rankings();
    if (!rankings) return [];
    return Array.from({ length: rankings.toWeek - rankings.fromWeek + 1 }, (_, i) => rankings.fromWeek + i);
  });

  readonly status = computed<TradesStatus>(() => {
    if (!this.teamState.importRequest()) return 'idle';
    if (this.startSit.error()) return 'error';
    if (this.outlook.error()) return 'unavailable';
    const league = this.outlook.league();
    if (league && !league.lineupSlots.length) return 'unavailable';
    // The available players aren't needed: a trade only involves rostered players, so rankings
    // without them (rosteredOnly) still do.
    const rankingsStatus = this.rankingsService.status();
    if (rankingsStatus === 'unavailable' || rankingsStatus === 'over') return rankingsStatus;
    if (rankingsStatus === 'loading' || !league || !this.startSit.side() || this.projections.status() === 'loading') {
      return 'loading';
    }
    return this.weeks().length ? 'ready' : 'over';
  });

  readonly myTeam = computed(() => this.startSit.side()?.team ?? null);

  // The teams you could trade with, by name.
  readonly partners = computed(() => {
    const mine = this.teamState.myTeamId();
    return this.startSit
      .teams()
      .filter((t) => t.team.teamId !== mine)
      .sort((a, b) => a.team.name.localeCompare(b.team.name));
  });

  readonly partner = computed(() => {
    const id = this.trade().partnerId;
    return this.partners().find((t) => t.team.teamId === id) ?? null;
  });

  private readonly standings = computed(
    () => new Map((this.outlook.league()?.standings ?? []).map((s) => [s.teamId, s] as const)),
  );

  standingOf(teamId: number): Standing | undefined {
    return this.standings().get(teamId);
  }

  readonly myRoster = computed(() => this.rosterOf(this.myTeam()));
  readonly partnerRoster = computed(() => this.rosterOf(this.partner()));

  // A team's roster as the analyzer sees it. A player missing from the rankings (added since they
  // loaded, and outside the available pool) is projected from their own upcoming weeks.
  private rosterOf(team: MatchupTeam | null): TradeRosterPlayer[] {
    const rankings = this.rankings();
    if (!team || !rankings) return [];
    const starting = new Set(rankings.positions);
    const future = this.projections.futureProjectionOf();
    return team.team.players.map((p) => {
      const ranked = this.rankingsService.rankOf(p.playerId);
      const projections =
        ranked?.weeklyProjections ?? Object.fromEntries(this.rankingWeeks().map((w) => [w, future ? future(p, w) : 0]));
      const pickable = starting.has(p.position);
      return {
        playerId: p.playerId,
        position: p.position,
        projections,
        injuredReserve: p.slot === 'IR',
        droppable: pickable && p.slot !== 'IR',
        player: p,
        ranked,
        pickable,
      };
    });
  }

  // Picks no longer on either roster (moved since the trade was set up), left out of the analysis.
  readonly missing = computed(() => {
    const trade = this.trade();
    if (this.status() !== 'ready' || trade.partnerId === null || !this.partner()) return [];
    return missingPicks({ ...trade, partnerId: trade.partnerId }, this.myRoster(), this.partnerRoster());
  });

  readonly analysis = computed<TradeAnalysis<TradeRosterPlayer> | null>(() => {
    const league = this.outlook.league();
    const trade = this.trade();
    if (this.status() !== 'ready' || !league || trade.partnerId === null || !this.partner()) return null;
    // A player at a position no slot takes can't be traded here, even from an edited address.
    const pickable = (roster: TradeRosterPlayer[], ids: number[]) =>
      ids.filter((id) => roster.find((p) => p.playerId === id)?.pickable ?? true);
    return tradeAnalysis({
      mine: this.myRoster(),
      theirs: this.partnerRoster(),
      trade: {
        partnerId: trade.partnerId,
        send: pickable(this.myRoster(), trade.send),
        get: pickable(this.partnerRoster(), trade.get),
      },
      slots: league.lineupSlots,
      weeks: this.weeks(),
      rosterSize: league.rosterSize,
      irSlots: league.irSlots,
    });
  });

  // When trades close, and whether that's passed (as of the start/sit clock). Null when ESPN doesn't
  // send a deadline.
  readonly deadline = computed(() => {
    const iso = this.outlook.league()?.tradeDeadline;
    return iso ? new Date(iso) : null;
  });
  readonly deadlinePassed = computed(() => {
    const deadline = this.deadline();
    return !!deadline && deadline.getTime() <= this.startSit.now().getTime();
  });

  // The rosters the odds are rerun with: both teams after the trade and its drops. Received players
  // go to the bench, or IR when they stay on it. Equal rosters compare equal, so the odds only rerun
  // when the trade or the base odds change.
  private readonly oddsRequest = computed(
    () => {
      const analysis = this.analysis();
      const mine = this.myTeam();
      const partner = this.partner();
      const base = this.outlook.odds();
      if (!analysis || !mine || !partner || base?.status !== 'ready' || !base.odds) return null;
      const rosters = new Map([
        [mine.team.teamId, playersAfter(mine, analysis.you)],
        [partner.team.teamId, playersAfter(partner, analysis.them)],
      ]);
      const key = [...rosters]
        .map(([teamId, players]) => `${teamId}:${players.map((p) => `${p.playerId}${p.slot}`).join(',')}`)
        .join('|');
      return { base: base.odds, rosters, fromWeek: analysis.weeks[0], key };
    },
    { equal: (a, b) => a === b || (!!a && !!b && a.base === b.base && a.key === b.key && a.fromWeek === b.fromWeek) },
  );

  private readonly oddsLoad = toSignal(
    toObservable(this.oddsRequest).pipe(
      switchMap((request) =>
        request
          ? delay(ODDS_DEBOUNCE_MS).pipe(
              switchMap(() => this.outlook.oddsAfter(request.rosters, request.fromWeek)),
              map((after) => ({ status: 'ready' as const, base: request.base, after })),
              startWith({ status: 'loading' as const }),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  // Null (the block left out) with no trade to judge, once the regular season is over, or when the
  // odds can't be rerun.
  readonly odds = computed<TradeOddsView | null>(() => {
    const analysis = this.analysis();
    const base = this.outlook.odds();
    const mine = this.myTeam();
    const partner = this.partner();
    if (!analysis || !base || !mine || !partner) return null;
    if (base.status === 'loading') return { status: 'loading' };
    if (!base.odds) return null;
    const load = this.oddsLoad();
    if (!load || load.status === 'loading' || load.base !== base.odds) return { status: 'loading' };
    if (!load.after) return null;
    const change = (teamId: number) => oddsChange(base.odds!, load.after!, teamId);
    const you = change(mine.team.teamId);
    const them = change(partner.team.teamId);
    if (!you || !them) return null;
    return { status: 'ready', you, them, byes: base.odds.byes > 0 };
  });
}

// Emits once after ms. A plain timeout rather than rxjs's timer, whose scheduler would otherwise be
// pulled into a chunk the initial bundle shares.
function delay(ms: number): Observable<void> {
  return new Observable<void>((subscriber) => {
    const id = setTimeout(() => {
      subscriber.next();
      subscriber.complete();
    }, ms);
    return () => clearTimeout(id);
  });
}

// A team's players after a trade: those sent and dropped gone, those received on the bench (or IR).
function playersAfter(team: MatchupTeam, side: TradeSide<TradeRosterPlayer>): Player[] {
  const gone = new Set([...side.sent, ...side.drops].map((p) => p.playerId));
  return [
    ...team.team.players.filter((p) => !gone.has(p.playerId)),
    ...side.received.map((r) => ({ ...r.player, slot: r.injuredReserve ? 'IR' : 'BE', starter: false })),
  ];
}

function oddsChange(before: PlayoffOdds, after: PlayoffOdds, teamId: number): OddsChange | null {
  const b = before.teams.find((t) => t.teamId === teamId);
  const a = after.teams.find((t) => t.teamId === teamId);
  return a && b ? { before: b, after: a } : null;
}
