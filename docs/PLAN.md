# FantasyX — Plan

## Status (as of 2026-09-30)

| Milestone | GitHub issue / branch | State |
|---|---|---|
| v1 — ESPN team import & display | #1 `1-init` (PR #2) | Shipped, merged |
| v1.1 — Device-based credential persistence | #1 `1-init` (PR #2), RLS follow-up PR #5 | Shipped, merged |
| v1.2 — Expanded roster UI | #3 `3-expand-ui` | Built; commits reached `main` via PR #5's branch. Issue closed |
| v1.3 — Player detail view | #4 `4-add-player-view` (PR #6) | Merged |
| v1.4 — League view | #7 `7-add-league-view` (PR #9) | Merged |
| v1.5 — Matchup view | #8 `8-add-matchup-view` (PR #10) | Merged. The live-league verification pass is still outstanding (see v1.5 Verification) |
| Restore import on refresh | #11 `11-restore-import-on-refresh` (PR #12) | Merged |
| v1.6 — Win probability | #13 `13-add-win-probability-to-the-matchup-view` (PR #14) | Merged. Its spreads endpoint was replaced in v1.7 |
| v1.7 — Custom projections | #15 `15-add-custom-projections-with-an-espn-fantasyx-setting` | Built and checked against a live league. Not yet merged |

Sections below were first written as forward-looking plans. v1 and v1.1 are kept as the design record, with corrections where the build turned out differently.

---

# v1 Plan: ESPN Team Import & Display

## Context

When this plan was written, FantasyX was a new, empty repo (README only) meant to become a fantasy football dashboard: import your team from an existing platform (starting with ESPN), view it, and eventually get insights/news. The user wants to scope v1 down to just "import and display" — pull a team's roster from ESPN and render it — before any analytics/insights work begins.

Key constraint discovered during planning: ESPN has no public/official Fantasy Football API or OAuth. The only way to read a *private* league is by presenting the `espn_s2` and `SWID` session cookies from an already-authenticated ESPN browser session as headers on requests to ESPN's undocumented v3 fantasy API. Public leagues need no auth, just numeric IDs. The user explicitly decided **against** having the backend handle ESPN usernames/passwords (the FantasyPros-style approach) due to the security/ToS risk of relaying real credentials through a third-party server. For v1, private-league support will use manual cookie paste (user copies `espn_s2`/`SWID` from their browser's devtools into a form); a more automated capture method can be revisited later.

Decisions locked in with the user:
- **Monorepo**: `/frontend` (Angular) and `/backend` (ASP.NET Core, C#) in this one repo.
- **Backend**: ASP.NET Core (.NET 8) — switched from an initial Spring Boot skeleton once the user decided this project would double as a C#/.NET learning exercise (no prior .NET/C# experience, but has used C). Nothing beyond the skeleton existed yet, so the switch was free.
- **No database in v1** — fetch from ESPN on demand and render; nothing persisted server-side.
- **Private leagues**: supported via manual `espn_s2`/`SWID` paste, not automated login.

## Scope for v1

In scope:
1. User enters a league ID, season/year, and team (public league) — or additionally pastes `espn_s2`/`SWID` (private league) — and imports their team.
2. Backend calls ESPN's v3 fantasy API, forwarding cookies when supplied, and maps the response into a simplified team/roster model.
3. Frontend displays the roster (starters + bench) with player name, position, NFL team, and headshot.
4. Clear error states: invalid league/team ID, private league missing/invalid cookies, ESPN API unreachable.

Explicitly out of scope for v1 (defer): insights/analytics, news feed, other platforms (Yahoo/Sleeper), persistence/accounts, automated ESPN login, deployment/hosting.

## Architecture

```
FantasyX/
├── backend/    ASP.NET Core (.NET 8) — REST API that proxies/transforms ESPN's fantasy API
└── frontend/   Angular SPA — import form + team display view
```

Request flow: Angular form → `POST /api/espn/team` (leagueId, season, teamId, optional espn_s2/SWID) → ASP.NET Core service calls `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}?view=mRoster&view=mTeam` (with `Cookie: espn_s2=...; SWID=...` header when private). The base URL is `lm-api-reads.fantasy.espn.com`, not `fantasy.espn.com`: private-league reads failed against the latter (fixed in 95c2012). It is configured as `Espn:BaseUrl` in `appsettings.json`. v1.2 added more views to this call (see below). → backend maps ESPN's JSON into a clean `TeamDto`/`PlayerDto` → Angular renders roster table.

Cookies are passed through per-request only (request body/headers) — never logged or persisted server-side, consistent with the no-DB, no-credential-storage decision.

## Backend (`/backend`)

- ASP.NET Core Web API, .NET 8, C#, controller-based (`dotnet new webapi -controllers`).
- `EspnFantasyController` — REST endpoints:
  - `POST /api/espn/team` — body: `{ leagueId, season, teamId, espnS2?, swid? }` → returns mapped team/roster.
  - `POST /api/espn/leagues/teams` — body: `{ leagueId, season, espnS2?, swid? }` → lists teams in a league first (so the user can pick their team instead of knowing the numeric team ID).
- `EspnFantasyService` (behind `IEspnFantasyService`, DI-injected) — a typed `HttpClient` (via `AddHttpClient`) calls ESPN with the right `view` query params, sets the cookie header conditionally, and maps non-2xx/redirect responses to a clean `EspnApiException` (ESPN 302-redirects rather than 404s on a bad league ID — auto-redirect is disabled on the handler so this can be detected).
- DTOs: `TeamDto`, `PlayerDto` (C# records) mapped from ESPN's raw response shape (also records, in `Models/Espn`).
- CORS policy in `Program.cs` permitting the Angular dev origin (e.g. `http://localhost:4200`), configured via `appsettings.json`.
- `IExceptionHandler` (`EspnApiExceptionHandler`) maps `EspnApiException` to the right HTTP status; `[ApiController]` gives automatic 400s for DTO validation failures.
- No repository/persistence layer, no database dependency.
- Verified against ESPN's live API during scaffolding (`dotnet build`/`dotnet run` are available locally): confirmed a bad league ID now returns a clean mapped 404 and a missing required field returns an automatic 400.

## Frontend UI library

All the mainstream Angular component libraries are free (MIT-licensed) for personal use — no paid tier needed:

| Library | Notes |
|---|---|
| Angular Material | Official, Google-maintained, MIT. ~35 components. |
| **PrimeNG** (chosen) | MIT, free, largest free component set (80+) — rich `p-table` (built-in sorting/filtering/grouping/column toggling), plus charts, which will suit both the v1 roster view and later insights/analytics screens without a library swap. |
| NG-ZORRO | MIT, Ant Design look. |

**v1 choice: PrimeNG + Tailwind CSS** — per user preference and prior experience. Installed via `npm install primeng @primeng/themes`. Tailwind CSS is added via `ng add @angular/tailwind` (or manual `npm install tailwindcss` + PostCSS config) for utility-first layout/spacing in templates, replacing hand-written component stylesheets where possible. PrimeNG v18+'s theming (`@primeng/themes`) is designed to coexist with Tailwind (no PrimeFlex needed) — PrimeNG handles component look-and-feel, Tailwind handles page layout/spacing/responsive utility classes. `p-table` for the roster (starters/bench, sortable columns), `p-inputtext`/`p-select`/`p-panel` for the import form (including the collapsible private-league cookie section), `p-progressSpinner` and `p-toast`/`p-message` for loading/error states.

## Frontend (`/frontend`)

- Angular 19 (PrimeNG 19, Tailwind CSS 3.4), standalone components, Angular CLI scaffolding.
- PrimeNG (`npm install primeng @primeng/themes`) for styled form/table/card components, plus Tailwind CSS for layout utility classes (see UI library section above).
- `ImportTeamComponent` — form: League ID, Season, and either a Team ID field or a "fetch teams" step to pick from a dropdown; collapsible "Private league?" section with instructions for finding `espn_s2`/`SWID` in browser devtools and two inputs for pasting them.
- `TeamDisplayComponent` — renders roster: starters and bench grouped, player name/position/pro team/headshot, injury flag if present.
- `EspnApiService` — thin HTTP client wrapping the backend's `/api/espn/*` endpoints.
- Basic loading/error UI states (invalid ID, auth failure, network error) surfaced from backend error responses.
- Routing: `/import` → `/team` (as built). The imported team and the request that produced it live in memory in `TeamStateService`, so a refresh on `/team` loses them and the user has to import again.

## Verification

1. **Backend**: `dotnet run`; `curl` or the included `FantasyX.Backend.http` file against `/api/espn/team` with a known **public** ESPN league ID/season/team to confirm a mapped roster JSON comes back. Then repeat with a private league + real `espn_s2`/`SWID` pasted from a browser session to confirm the cookie forwarding path works and that a bad/missing cookie produces a clear 401/403-mapped error.
2. **Frontend**: `ng serve`; manually run the import flow end-to-end against the local backend for both a public and a private league; confirm roster renders correctly and error states display for a bad league ID.
3. Confirm CORS works between `localhost:4200` and the backend's port with no manual workarounds needed.

---

# v1.1 Plan: Device-Based Credential Persistence

## Context

v1 (above) is shipped and working, but re-pasting `espn_s2`/`SWID` on every visit turned out to be genuinely annoying in practice. The user wants that fixed, and asked specifically about account/login options plus free database hosting.

Decisions locked in with the user (via clarifying questions):
- **Single-user** — this app is just for the user, not friends/family, for now.
- **No real accounts/login** — given single-user scope, a full auth system isn't worth building yet. Instead: **device-based persistence** — an opaque ID generated and stored in the browser (`localStorage`), used to key a saved-credentials row server-side. No password, no signup flow.
- **Database: Supabase** (free Postgres tier), chosen by the user directly. Postgres also has first-class .NET support via Npgsql/EF Core.

This is a deliberate, scoped reversal of v1's "cookies are never persisted" design — done carefully (see Security notes below), not casually.

## Architecture / flow

Frontend generates a `crypto.randomUUID()` on first load, persists it in `localStorage`, and sends it with save/load requests → backend encrypts `espn_s2`/`SWID` via ASP.NET Core's Data Protection API before writing to a new Postgres table on Supabase, decrypts on read → next visit, the frontend fetches by `deviceId` and prefills the import form automatically.

## Backend (`/backend`)

- NuGet: `Npgsql.EntityFrameworkCore.PostgreSQL`, `Microsoft.EntityFrameworkCore.Design`.
- `Data/FantasyXDbContext.cs` — EF Core `DbContext` with one `DbSet<SavedCredentials>`.
- `Models/SavedCredentials.cs` — entity: `DeviceId` (Guid, PK), `EncryptedEspnS2`, `EncryptedSwid`, `LastLeagueId?`, `LastSeason?`, `LastTeamId?` (saving these too since it's the same row and removes the rest of the re-entry friction, not just the cookies), `UpdatedAtUtc`.
- `Services/CredentialProtector.cs` — thin wrapper around `IDataProtector` (a dedicated purpose string, e.g. `"FantasyX.SavedCredentials"`) with `Protect`/`Unprotect` helpers.
- `Controllers/CredentialsController.cs`:
  - `GET /api/credentials/{deviceId}` → decrypted DTO, or 404 if nothing saved.
  - `PUT /api/credentials/{deviceId}` → upsert; encrypts before writing.
  - `DELETE /api/credentials/{deviceId}` → "forget me" / clear saved data.
- `Program.cs`: `builder.Services.AddDbContext<FantasyXDbContext>(o => o.UseNpgsql(connectionString))`, `builder.Services.AddDataProtection()`.
- **Connection string**: set locally via .NET Secret Manager (`dotnet user-secrets set "ConnectionStrings:FantasyX" "..."`) — never committed to `appsettings.json`/git. Production deployment will need it injected as an environment variable; exact mechanism depends on whatever hosting platform eventually gets picked (still an open question from earlier — not solved here).
- **Supabase connection specifics** (verified against Supabase's own changelog, since this has changed and generic/older guidance is wrong): do **not** use the direct `db.<project-ref>.supabase.co:5432` host — it's been IPv6-only since a 2023 deprecation, and will fail to connect from an ordinary IPv4 network without paying for Supabase's IPv4 add-on. Use the **Supavisor pooler's session-mode connection**, which is a *different hostname* (something like `aws-0-<region>.pooler.supabase.com`) on port `5432` — supports prepared statements, correct for a long-running server like this one. Port `6543` on the pooler is transaction-mode only (as of Feb 2025) and disables prepared statements — not what we want here. Get the exact session-pooler connection string from the Supabase dashboard: Project Settings → Database → Connection String → "Session pooler" (not "Direct connection" or "Transaction pooler"). Require SSL (`SSL Mode=Require`).
- As built, `Program.cs` also accepts the dashboard's `postgres://user:pass@host:port/db` URI form and converts it to Npgsql keyword format itself, forcing `SslMode.Require`. That means the dashboard string can be pasted into user-secrets unchanged.
- Migrations: `AddSavedCredentials`, then `dotnet ef database update` against the real Supabase instance.

## Frontend (`/frontend`)

- `services/device-id.service.ts` — generates and persists the device UUID in `localStorage` on first run, reused thereafter.
- `services/credentials-api.service.ts` — thin wrapper over `GET`/`PUT`/`DELETE /api/credentials/{deviceId}`.
- `ImportTeamComponent` changes:
  - On init, calls the credentials API; if a saved record exists, prefills league/season/team/cookies and turns the private-league toggle on automatically.
  - New **"Remember these details on this device"** checkbox — explicit opt-in, since these are live ESPN session cookies. Only saves on a successful import, and only when checked.
  - New **"Forget saved details"** action — calls `DELETE`, clears `localStorage`.

## Security notes (not optional — treat as core scope, not polish)

- `espn_s2`/`SWID` must be encrypted at rest via Data Protection — never stored in plaintext in Postgres.
- **Row Level Security (added during build and missing from the original plan):** Supabase exposes the `public` schema through its Data API (PostgREST) to the `anon`/`authenticated` roles. Every table the backend creates therefore gets RLS enabled with **no policies**. The backend connects as the table owner and bypasses RLS, while the Data API is denied entirely. This is done in migrations `EnableRlsOnSavedCredentials` (`saved_credentials`) and `EnableRlsOnEfMigrationsHistory` (`__EFMigrationsHistory`, PR #5). **Any future table needs the same treatment in its own migration.** Check with Supabase's security advisors after each migration.
- With no account/password, the `deviceId` is effectively a bearer credential for that saved data. Acceptable for the single-user scope the user chose, but worth them knowing explicitly.
- Data Protection's default key ring is per-machine/local by default — fine for local dev now, but once a hosting platform is chosen, key persistence needs revisiting or a redeploy could make previously-encrypted rows unreadable.
- The README's "Private ESPN leagues... are sent per-request to the backend and are never persisted or logged" line becomes inaccurate and must be rewritten to describe encrypted, device-scoped, opt-in persistence instead.

## Verification

1. `dotnet ef database update` against the real Supabase instance; confirm the new table exists via the Supabase dashboard or `psql`.
2. Backend: `PUT` then `GET` credentials via the `.http` file/curl; confirm the round-trip works, and spot-check the raw Postgres row (Supabase SQL editor) to confirm `espn_s2`/`SWID` are not stored in plaintext.
3. Frontend: check "remember," successfully import a private team, reload the page — the form should prefill automatically with no retyping.
4. Clear `localStorage` (simulating a new device) — the form should come back blank, confirming persistence is properly device-scoped rather than global.
5. Use "Forget saved details" — confirm the row is deleted and a reload no longer prefills anything.

---

# v1.2: Expanded Roster UI (issue #3) — built

Recorded after the fact. The roster view grew well beyond v1's name/position/team/headshot table:

- **Backend:** `GET team` now also requests `mStatus` (current week via `LatestScoringPeriod`), `mPositionalRatings` (opponent rank vs. position) and `mSettings` (league name). It also fetches `seasons/{season}?view=proTeamSchedules_wl` for opponents and kickoff times. `TeamDto` gained `LeagueName`, W-L-T, `StandingRank` and `LeagueSize`. `PlayerDto` gained `Slot`, projected/actual points for the week, opponent, home/away, game time, `OpponentPositionRank`, and `IsTeamLogo` (D/ST uses the team logo, not a headshot).
- **Frontend (`TeamDisplayComponent`):** starters sorted into standard lineup order and a bench table aligned to them by a Slot column. Name is shown with position and team underneath. Status tags are color-coded. Opponent and kickoff are shown, plus matchup strength as a read-only `p-rating` in its own column. Projected and actual points are right-aligned, with a starters total row. The header shows league name, a `p-meter` W-L-T bar and standings position. Headshots are pre-resized, and the redundant "D/ST" suffix is trimmed.

**Open:** issue #3 is still open on GitHub even though this work is on `main`. Close it, or list anything still wanted in it.

---

# v1.3: Player Detail View (issue #4) — in progress on `4-add-player-view`

## Goal

Clicking a player on the roster opens a detail drawer: season summary, a week-by-week game log with stat lines, a points-vs-projection chart, and a per-game scoring breakdown.

## Backend

- `POST /api/espn/player`, with body `{ leagueId, season, playerId, espnS2?, swid? }` and response `PlayerDetailDto`. `playerId` is not range-checked because D/ST ids are negative.
- One league call with views `kona_playercard`, `mStatus` and `mPositionalRatings`. An `x-fantasy-filter` header narrows it to the player and to scoring periods 1–18 (`RegularSeasonWeeks`). Filters on source/split type alone return only season totals plus the current week, so listing the weeks is what makes real leagues return a full game log. The pro-team schedules call runs in parallel.
- Season totals are summed from the weekly entries, because the per-week query returns no season-total rows. Actuals use `statSourceId` 0 and projections use `statSourceId` 1.
- Current week is `LatestScoringPeriod`. If the league doesn't report it, it falls back to the player's team's first game that isn't final.
- `PlayerDetailDto` contains: identity/injury/headshot fields, `CurrentWeek`, `Summary` (total, average, games played, position rank, season projection, rest-of-season projection), `StatColumns`, and `Games`. Each game has a `PlayerGameStatus` of Played/DidNotPlay/Bye/Upcoming, plus opponent, home/away, time, opponent rank, projected and actual points, a `StatLine` aligned to `StatColumns`, and a `ScoringBreakdown` of `ScoringLineDto` items (label, raw stat, points each, points). `StatLine` and `ScoringBreakdown` are only set for Played games.

## Frontend

- `PlayerDetailService`: a session cache keyed by `league:season:player`. It fetches on first open and can force a refetch for live scores. The whole cache is cleared when a different import is active. It reads its league context and cookies from `TeamStateService.importRequest`, so private-league cookies are never re-entered or stored anywhere new.
- `PlayerDetailDrawerComponent` (`p-drawer`), opened from the roster. It shows a summary header, a `p-chart` (chart.js) of weekly points against projection with the projection as a dotted legend segment, and a game-log `p-table` with opponent-strength `p-rating`. Clicking a game's points opens a `p-popover` with its scoring breakdown. It also has loading/error states with Retry.

## Remaining before PR

1. **Rebase/merge `origin/main`.** This branch is missing PR #5 (`EnableRlsOnEfMigrationsHistory`), so the local migration set is behind the live database.
2. **Playoff weeks:** `RegularSeasonWeeks = 18` stops the game log at week 18. Decide whether to include ESPN fantasy playoff weeks, which fall inside 1–18 for most leagues but not all, or to derive the week count from `mSettings`.
3. **README:** the "Status" line still describes v1 scope only. Mention the roster expansion and player detail.
4. Verification below. A sample `POST /api/espn/player` already exists in `FantasyX.Backend.http`. Consider adding a D/ST case with a negative id.

## Verification

1. Backend: `POST /api/espn/player` via the `.http` file for a QB, a K, a D/ST (negative id) and an unknown id (expect a mapped 404). Do it for a public league and a private league.
2. Frontend: open the drawer for several positions. Check that Bye and Upcoming weeks render without stat lines, that the chart's actual and projection series line up with the table, that the scoring popover's lines sum to the game's points, and that reopening a player hits the cache (no network request) while Retry/refresh refetches.
3. Import a different team and confirm the player cache is cleared.

---

# v1.4: League View (issue #7) — on `7-add-league-view`

## Goal

A league page with this week's matchups and the standings. Clicking a team in the standings opens that team's roster in the existing roster view. Matchup tiles weren't clickable at first; v1.5 (issue #8) makes them open the matchup view.

## Decisions

- **Scope:** only current-period matchups and a standings table. League stats/leaders, a settings summary, the full schedule, a week picker and division grouping are deferred.
- **Navigation:** a header nav on every route with FantasyX, My Team, League, and Import/Change team. My Team and League are hidden until a team is imported. Import still lands on My Team.
- **Routes:** `/league`, `/team` (your own team) and `/team/:teamId` (any team). `index.html` gained `<base href="/">` so nested routes load assets correctly.
- **Other teams** reuse `TeamDisplayComponent` in full, including the player detail drawer. The differences are a "Viewing {Team} · Back to League" banner and no "Import a different team" link.
- **Fetching:** the league endpoint returns standings and matchups only. A team click calls the existing `POST /api/espn/team` lazily. Your own team is the cached import result, while other teams and the league are refetched on every visit (no caching).
- **Refresh:** still loses context, as before. Restoring it is deferred until the project's scope is clearer. *(Done later in #11 / PR #12: the last import's non-secret context is kept in `localStorage` and re-imported on startup.)*
- **Tests:** none (the repo has no test projects yet). Verification is manual.

## Backend

- `POST /api/espn/league` takes the same body as `leagues/teams` (`{ leagueId, season, espnS2?, swid? }`) and returns `LeagueDto`: `LeagueName`, `CurrentMatchupPeriod`, `Standings`, `Matchups`.
- One league call with views `mTeam`, `mStandings`, `mSettings`, `mStatus`, `mMatchupScore` and `mScoreboard`. The schedule is filtered to `status.currentMatchupPeriod`, and byes (no away side) are dropped.
- `StandingDto`: seed (`playoffSeed`, sorted with unranked 0s last), name, abbrev, logo, owner names, W-L-T, PF, PA and a compact streak (`W3`/`L1`). Owner names are resolved by matching `team.owners` to `members[].id` ("First Last", falling back to display name).
- `MatchupSideDto`: team id, points (`totalPointsLive` falling back to `totalPoints`), and projected points (`totalProjectedPointsLive`, null when ESPN doesn't send it). Team names and logos are joined client-side from standings.
- The ESPN records gained nullable fields only (`Members`, `Schedule`, `Logo`, `Owners`, record points/streak, `CurrentMatchupPeriod`), so existing calls are unaffected.

## Frontend

- `LeagueComponent`: a standings `p-table` (your row highlighted, rows open the team's roster) beside a single column of `p-card` matchup tiles (your matchup first and outlined, winning score bold; not clickable yet). They stack on narrow screens. It has loading/error states with Retry and the "No team imported yet" empty state.
- Header nav uses PrimeNG `p-tabs` driven by the router (no tab is active on another team's page), plus a text `p-button` for Import/Change team.
- Uploaded team logos (`mystique-api.fantasy.espn.com`) 401 without ESPN cookies, so `POST /api/espn/logo` proxies them with the league's cookies (only that host/path is accepted, and it needs a `User-Agent` or ESPN's edge returns 403). `TeamLogoComponent` shows them via cached object URLs and falls back to the abbreviation.
- `TeamDisplayComponent` takes the `teamId` route param via `withComponentInputBinding` and adds loading/error/Retry states for other teams.
- `TeamStateService` gained a `myTeamId` computed signal.

## Verification

1. `POST /api/espn/league` via the `.http` file for a public league and a private league. Check that standings order, PF/PA, streaks, owners and matchup scores match ESPN's site.
2. Check the league page renders, your team is highlighted and your matchup comes first, and clicking an opponent opens their roster with the banner and a working player drawer. Also check that My Team returns to the cached roster and that Retry works after a failed load.
3. Load `/league` or `/team/3` directly with nothing imported and confirm the empty state renders (assets load thanks to the base href).

---

# v1.5: Matchup View (issue #8) — on `8-add-matchup-view`

## Goal

A head-to-head page for one matchup: both teams side by side, starters lined up slot by slot, so it's easy to see where each side is winning or losing.

## Decisions

- **Route:** by team, mirroring `/team`. `/matchup` is your own matchup and `/matchup/:teamId` is that team's current matchup. A **Matchup** nav tab sits between My Team and League.
- **Entry points:** the nav tab, league matchup tiles (your tile goes to `/matchup`, others to `/matchup/{homeTeamId}`), and a "View matchup" link on every roster page.
- **Data:** one new backend endpoint rather than reusing `/team` twice.
- **Weeks:** current week only. The week picker is still deferred.
- **Live updates:** refetched on every visit, plus a manual Refresh button that keeps the current scores on screen while it loads. No polling.
- **Multi-week periods:** the header totals are ESPN's for the whole matchup period, while player rows show the current scoring period (`LatestScoringPeriod`), the same as the roster view. No special playoff UI.
- **Players:** clicking any player on either side opens a modal with that player's scoring breakdown for the week, not the player detail drawer.

## Backend

- `POST /api/espn/matchup` takes the same body as `/team` (`{ leagueId, season, teamId, espnS2?, swid? }`) and returns `MatchupDetailDto`: `LeagueName`, `MatchupPeriod`, `ScoringPeriod`, `Team` and `Opponent`. Each side is a `MatchupTeamDto`: the full `TeamDto` roster, `LogoUrl`, `Points` and `ProjectedPoints`. `Team` is always the requested team. `Opponent` is null on a bye or when the team has no matchup this period.
- One league call with views `mRoster`, `mTeam`, `mStatus`, `mPositionalRatings`, `mSettings`, `mMatchupScore` and `mScoreboard`, in parallel with the pro-team schedules call. `mRoster` returns every team's roster, so both sides come from one call. The schedule entry is the one for `status.currentMatchupPeriod` that includes the requested team.
- Team mapping moved out of `GetTeamRosterAsync` into `ToTeamDto`, which both endpoints share.
- *Correction (built differently):* before merge, the single-matchup endpoint was replaced by `POST /api/espn/matchups`. It takes `{ leagueId, season, espnS2?, swid? }` and returns `WeekMatchupsDto`: every team's roster and score for the current period (`Teams`), plus the `Matchups` pairs. The frontend caches it for the session in `WeekMatchupsService` and switches between matchups without another request. Only Refresh or a different import refetches it.

## Frontend

- `MatchupComponent`: a scoreboard with each side's logo, name, record, score, projection and a "Leading" tag. Starters are paired by slot and by index within each slot (RB1 vs RB1). Rows are mirrored around a slot column, with the row leader in bold and starter totals in a footer. Benches sit in a collapsed `p-panel`. It has loading, error/Retry and "No matchup this week" states, plus the "Viewing …" banner for other teams. On phones the scoreboard stacks, and player cells drop the avatar, injury tag and kickoff.
- The player modal (`p-dialog`) uses `PlayerDetailService.load(id, force = true)` and shows the game for `scoringPeriod`. That's the breakdown table if the game was played, and otherwise "Hasn't played yet", "Did not play", or "Bye week".
- `ScoringBreakdownComponent` was extracted from the drawer's popover table, so the drawer and the modal share it. The starter sort moved to `utils/player-format.ts` (`sortStarters`).
- The header nav shows icon-only tabs and an icon-only Import/Change team button on phones, so three tabs fit.

## Verification

1. `POST /api/espn/matchup` via the `.http` file for a public league and a private league. Check that both rosters, scores and projections match ESPN's matchup page, that a bye returns `opponent: null`, and that an unknown team id returns a mapped 404.
2. UI checked against a mock API: slot pairing, totals, Leading tag, the modal's Played/Upcoming/Bye states and Esc/backdrop close, the bench toggle, Refresh, league tile navigation with the banner, the no-matchup state, the drawer popover unchanged, and no horizontal overflow at 375px. Still to do against a live league: the same pass with real data, including a D/ST and a player whose game is in progress.

---

# v1.6: Win Probability (issue #13) — on `13-add-win-probability-to-the-matchup-view`

## Goal

Show each side's chance of winning on the matchup view. It updates with live scores, so it's easy to see how safe a lead is. This is the first insights feature.

## Decisions

- **Model:** a normal approximation of the final margin, per side:
  - `expected = Points + Σ remaining(starter)`, where `Points` is the side's live matchup total, so points already scored are counted once
  - `variance = Σ remainingFraction(starter) × spread(starter)²`
  - `P(team wins) = Φ((expectedTeam − expectedOpp) / √(varTeam + varOpp))`. When the variance is 0 (everything final), the result is 100/0, or 50/50 on a tie.
- **Remaining points per starter**, from the pro schedule the matchups call already fetches:
  - final (`StatsOfficial`): 0
  - not started: ESPN's week projection
  - in progress: projection × fraction of game left, estimated as `1 − elapsed / 3h15m` clamped to [0, 1]. This is rough on purpose, because the schedule has no game clock.
  - bye / no game: 0

  The frontend decides upcoming vs in progress from `gameTimeUtc` and the time the scores were fetched. The backend only adds `GameFinal` to `PlayerDto` (see Backend), so nothing time-dependent goes stale in the session cache.
- **Player spread:** the root mean square of (actual − projected) over the player's played weeks this season (defined for one game, and it includes projection bias, which is the error the model cares about). It's shrunk toward a position default: `spread² = (n·mse + k·d²) / (n + k)` with `k = 4`. With no history, the spread is the default `d`. The per-position defaults (QB, RB, WR, TE, K, D/ST) are **placeholder constants to tune during verification**, not researched values.
- **Split between backend and frontend:** the backend returns each player's raw residual stats (`GamesUsed`, `MeanSquaredError`). The frontend does the shrinkage and computes the probability, so every tunable constant lives in one file (`utils/win-probability.ts`). Spreads only change week to week, so they're fetched once per session alongside the cached week of matchups. Refresh then recomputes from new scores immediately, and `/matchups` stays as fast as it is today.
- **Which players:** spreads for every rostered player in the league, including benches. That way, a lineup change picked up by Refresh already has a spread, and the matchup switcher needs no extra request.
- **Missed games:** ESPN sends a 0-point actual row for weeks a player didn't play, and zeroes the projection once they're ruled out. So:
  - a spread only counts weeks projected above 0
  - starters projected at 0 add no variance
  - the player drawer treats a week with a 0 actual and a 0 projection as DidNotPlay, which also fixes its games-played count and average (wrong since v1.3)
- **Colour:** each side's segment is green at 60% or more, red at 40% or less, and a neutral grey in between (compared with the percentage shown to the tenth, so 59.9% is grey and 60.0% green). The two segments are separate pills.
- **Certainty:** the bar only reads 100/0 once every starter on both sides has finished their game (or has none). Until then, anything past 99.9% shows as ">99.9%" / "<0.1%", and the smaller side keeps a 1% sliver of the bar. Percentages are shown to the tenth, rounded so the two sides always add up to 100.0.
- **Scope:** matchup view only. It's hidden in multi-week playoff periods (detected from `settings.scheduleSettings.matchupPeriods`), because player projections only cover `ScoringPeriod` while `Points` covers the whole period. League tiles, a probability-over-time chart and custom projections are deferred.
- **Failure:** if the spreads request fails, the bar still shows using position defaults, with a small "using position averages" note.

## Backend

- `PlayerDto` gains `GameFinal` (`EspnProGame.StatsOfficial`, false with no game). Other views ignore it.
- `WeekMatchupsDto` gains `ScoringPeriodsInMatchup`, read from `mSettings`' `scheduleSettings.matchupPeriods` (defaults to 1).
- `POST /api/espn/player-spreads` takes `{ leagueId, season, scoringPeriod, playerIds, espnS2?, swid? }` (at most 400 ids) and returns `PlayerSpreadDto[]`: `PlayerId`, `GamesUsed`, `MeanSquaredError`. Players ESPN doesn't return, and every player in week 1, get `GamesUsed = 0`.
- One `kona_playercard` call. Its `x-fantasy-filter` sets `filterIds` to all requested players, and `filterStatsForScoringPeriodIds` to weeks `1..scoringPeriod−1`. Don't add a `limit` field: ESPN answers 400 to that. It reuses `WeeklyStats` for actuals (source 0) and projections (source 1), and counts a week only when the player has both. Checked on a live league: all 203 rostered ids, D/STs included, came back from one request, so no batching is needed.

## Frontend

- `utils/win-probability.ts`: pure functions (`winProbability`, `remainingFraction`, `playerSpread`, `barTone`, `normalCdf`) and every tunable constant: position defaults, `SHRINKAGE_GAMES`, `GAME_LENGTH_MS`, `WINNING_AT_PERCENT`, `LOSING_AT_PERCENT`.
- `PlayerSpreadsService`: a session cache keyed on the import request and scoring period, the same pattern as `WeekMatchupsService`. It sends every rostered player id in the week. Refresh doesn't refetch it.
- `MatchupComponent`: a two-sided bar under the scoreboard, with the percentage on each end and the favourite in bold. It's green at 60% or more, red at 40% or less, and grey in between. It shows percentages to one decimal place, and ">99.9%" instead of 100.0% until every starter's game is done. An info icon's tooltip says it's "Based on ESPN projections and each player's week-to-week swing this season". There's a skeleton while spreads load. The bar recomputes on Refresh and on switching matchups, and is hidden on byes and in multi-week periods.
- Tests: Vitest (`npm test`) runs `src/**/*.spec.ts` in Node without Angular. `win-probability.spec.ts` is the first suite.

## Verification

1. Call `POST /api/espn/player-spreads` via the `.http` file for a league mid-season. Spreads should be plausible by position, and `GamesUsed` should match games played. A rookie or someone just returning from injury should fall back toward the default.
2. Before kickoff, the favourite should line up with ESPN's projected totals, and even matchups should sit near 50%. For comparison, check ESPN's own matchup-page odds if the site shows them.
3. During a live window: the probability should move as scores refresh and firm up as games go final. A finished matchup should read 100/0.
4. Edge cases: a bye (hidden), a spreads failure (defaults note), phone width (no overflow at 375px).
5. Tune the position defaults and `k` if the pre-kickoff numbers look too confident or too flat.

Done so far: the Vitest suite (16 tests). A UI pass against mocked data covered neutral 47/53 and 54/46, green/red at 78/22, 100/0 with only kickers left, Refresh with no second spreads request, the position-averages note on failure, hidden in multi-week periods, and no overflow at 375px. An endpoint smoke test covered the mapped 404, the week-1 short-circuit and 400 validation. Steps 1–5 against a live league remain.

---

# v1.7: Custom Projections (issue #15) — built on `15-add-custom-projections-with-an-espn-fantasyx-setting`

## Goal

FantasyX's own weekly projection for each player: ESPN's projection corrected by how far off ESPN has been for that player this season. A setting switches the whole app between ESPN projections and FantasyX projections. Only one source shows at a time, never both side by side. Default is ESPN.

## Decisions

- **One source at a time.** A single **Projections: ESPN / FantasyX** setting changes every projection figure in the app together, so no view mixes the two:
  - roster projections and the starters total
  - matchup player rows, starter totals and the scoreboard's team projection
  - league tile projections
  - the player drawer's weekly projections, chart and rest-of-season total
  - win probability

  A small "FantasyX projections" label shows beside projection figures while that source is active, so it's never ambiguous which one you're looking at.
- **Setting:** a gear button in the header opens a `p-popover` containing a `p-selectbutton`. It's stored per device in `localStorage` (`fantasyx.settings`), like the last import. There are no accounts, so nothing goes server-side. The popover also shows the backtest result (see below), so the choice is an informed one.
- **Model v1:** `custom = espn + bias`. `bias` is the player's mean signed miss (actual − ESPN projection) over earlier weeks, shrunk toward 0: `bias = n·mean / (n + k_b)`. Weeks are only counted when projected above 0, reusing v1.6's missed-game rule. Shrinkage matters: early in the season `bias ≈ 0` and FantasyX equals ESPN, which is the honest answer with 1–3 games.
  - **Candidate second term,** kept only if the backtest shows it helps: a position-level adjustment by opponent defensive rank. `opponentPositionRank` is already on `PlayerDto`, but nothing uses it yet.
  - Players projected at 0 stay at 0 (ruled out), and bias never takes a projection below 0.
- **Backtest before shipping.** Walk forward: for each past week `w`, build each player's projection from weeks `< w` only, then compare its error with ESPN's for week `w`. Report mean absolute error and RMSE per player-week across every rostered player. The constants (`k_b`, the rank term) are tuned against this. The toggle ships regardless (you want the choice), but the default stays ESPN and the popover shows the comparison.
  - The walk-forward projections double as the drawer's historical "FantasyX projection" for past weeks, so the chart shows what FantasyX *would have* projected at the time, never a hindsight fit.
- **Win probability follows the setting.** Expected points use the active projections. Each player's spread is measured against the *same* source: residuals from ESPN in ESPN mode, from walk-forward FantasyX projections in FantasyX mode. Otherwise the uncertainty wouldn't match the numbers it's applied to.
- **Team totals in FantasyX mode:** `points + Σ remaining FantasyX starter projections`, the same expected score win probability uses. That replaces ESPN's `totalProjectedPointsLive` on the scoreboard and league tiles.
- **Scope:** the current season and rostered players only. Free agents, previous seasons, and other signal such as snaps and targets are deferred. Multi-week playoff periods behave as v1.6: projections cover `ScoringPeriod` only.

## Backend

- Replace the aggregate from `POST /api/espn/player-spreads` with the raw weekly history. `POST /api/espn/player-history` takes the same request and returns `PlayerHistoryDto[]`: `PlayerId` plus `Weeks: { Week, Actual, Projected }[]`, with missed weeks (0/0) already dropped. Same single `kona_playercard` call, still without `limit`. MSE, bias, walk-forward projections and the backtest are all computed from this on the frontend, so no model constant lives in the backend.
- `player-spreads` is removed in the same change, since its only caller moves to the new endpoint.
- The player drawer's `POST /api/espn/player` is unchanged. Its games already carry ESPN's per-week projection, and the frontend swaps in walk-forward values in FantasyX mode.

## Frontend

- `utils/projections.ts` (new, pure): `playerBias`, `customProjection`, `walkForward(history)` (returns the per-week FantasyX projection) and `backtest(histories)` (returns `{ espn: { mae, rmse }, custom: { mae, rmse }, playerWeeks }`). All constants live here. Unit tested with Vitest, including a synthetic history with a known bias, where FantasyX should beat ESPN, and pure noise, where it shouldn't.
- `win-probability.ts`: `playerSpread` takes the residuals for the active source rather than a precomputed MSE. The rest is unchanged.
- `PlayerHistoryService` replaces `PlayerSpreadsService`, with the same per-week session cache.
- `SettingsService` (new): `projectionSource = signal<'espn' | 'fantasyx'>`, read from and written to `localStorage` with the same try/catch pattern as `TeamStateService`.
- A `ProjectionsService`, or a set of computeds, exposes `projectedPoints(player)`, `teamProjection(side)` and per-week drawer projections for the active source. Views read from it instead of `player.projectedPoints` directly. The places to switch over, from a grep of `projectedPoints`: `team-display` (rows + starters total), `matchup` (rows, starter totals, scoreboard, modal "Proj"), `league` tiles, `player-detail-drawer` (table, chart, hit/miss colouring, rest-of-season).
- If history fails to load, FantasyX mode falls back to ESPN figures with a small "FantasyX projections unavailable" note. It never silently shows ESPN numbers under a FantasyX label.
- Header: the gear button next to Import/Change team. Icon-only on phones, like the existing nav buttons.

## Verification

1. Vitest: bias shrinkage, projections floored at 0, walk-forward using only earlier weeks, and the backtest on synthetic data (a known bias is recovered and beats ESPN; pure noise shows no gain).
2. Live league: run the backtest and record MAE/RMSE for both sources in this section. Tune `k_b`, and test the opponent-rank term, until FantasyX is at least no worse than ESPN overall.
3. Toggle both ways on every affected view. All figures switch together, the "FantasyX projections" label appears, the setting survives a reload, and win probability changes to match.
4. Early-season sanity check: with 1–3 games, FantasyX projections should sit very close to ESPN's.
5. History failure: FantasyX mode falls back with the note. Phone width: the gear and popover fit at 375px.

## Open questions

- Whether a per-player bias beats ESPN at all over a single season's rostered players, which is a small sample. If not, a position-level bias or the opponent-rank term may be all that's worth keeping. The backtest decides.
- Whether to also backtest against last season's data, where the league existed then, to tune constants on a larger sample.

---

# Backlog (still deferred)

Insights beyond custom projections (league-tile odds, probability over time, projections using usage data such as snaps and targets), news feed, other platforms (Yahoo/Sleeper), real accounts, automated ESPN login, and deployment/hosting. Hosting is the next one to hit a hard dependency: Data Protection key persistence and connection-string injection (see v1.1 notes) both wait on it.

## As built

- **Backend:** `POST /api/espn/player-history` replaces `player-spreads`, which is removed. It returns `PlayerHistoryDto[]`: `PlayerId` plus `Weeks: { Week, Actual, Projected, OpponentPositionRank }[]`. Weeks count under v1.6's rule: before the scoring period, with an actual row and a projection above 0.
  - The rank is added so the opponent-rank term can be tested. It's the opponent's *current* rank against the player's position (`mPositionalRatings`), found the same way the drawer finds each week's game (by game id, so traded players get the right opponent). That lookup is now a shared `GameFor` helper.
  - The call adds the `mPositionalRatings` view, and the pro schedules are fetched in parallel.
- **Model** (`utils/projections.ts`): `fantasyx = espn + bias + slope(position) × rankOffset`.
  - `bias = Σ(actual − projected) / (n + BIAS_SHRINKAGE_GAMES)`.
  - The rank term is a per-position ridge slope (`RANK_SHRINKAGE`) of the bias-corrected miss on the rank, scaled to [−1, 1]. It's pooled across the league and fitted walk-forward.
  - `USE_RANK_TERM` switches the rank term on or off.
  - A projection of 0 stays 0, and the result is floored at 0.
  - `buildModel` projects any player-week from earlier weeks only. The drawer uses it for past weeks, and the backtest reuses it.
- **Frontend:**
  - `SettingsService` stores `fantasyx.settings`. `PlayerHistoryService` replaces `PlayerSpreadsService`.
  - `ProjectionsService` is the single source every view reads from: `projected`, `teamTotal`, `gameProjection`, `projectionOf` and `residualsOf` for win probability, and `backtest`.
  - History is loaded through the cached week of matchups: once per session, only in FantasyX mode or when the matchup view or settings popover asks for it.
  - While FantasyX figures load, cells read "—".
  - `win-probability.ts` takes a projection function and per-player residuals. `playerSpread` is unchanged apart from taking the misses directly. `teamOutlook` is exported for the FantasyX team totals.
- **UI:**
  - A gear button in the header (shown once a team is imported) opens a popover with an ESPN / FantasyX `p-selectbutton` and the backtest table.
  - `ProjectionSourceComponent` shows the "FantasyX projections" tag beside the Starters and Matchups headings and in the drawer. It shows "FantasyX projections unavailable, showing ESPN's" when history fails, and it notes when team totals stay ESPN's in multi-week rounds.
  - The drawer's chart line is labelled "FantasyX projected". Its rest-of-season figure sums FantasyX projections over the upcoming non-bye games.
  - Win probability's tooltip names the active source.

## Backtest (live 14-team league, after week 3: 572 rostered player-weeks)

| Model | MAE | RMSE |
|---|---|---|
| ESPN | 5.364 | 6.745 |
| Per-player bias, k_b = 6 (first guess) | 5.398 | 6.796 |
| Per-player bias, k_b = 20 (shipped) | 5.365 | 6.748 |
| Per-position bias (tried, not shipped) | 5.376–5.416 | 6.749–6.769 |
| Bias + opponent rank, λ = 20 | 5.18 | 6.55 |

- **No bias to find yet.** Through 3 weeks, ESPN shows no per-player or per-position bias in this league. Every smaller `k_b` did worse than ESPN, and a larger one only moved closer to it. `BIAS_SHRINKAGE_GAMES = 20` keeps FantasyX level with ESPN now, while still letting a real bias show once players have 8–10 games. The position-level bias didn't help either: the mean miss by position swung week to week with no consistent sign.
- **The rank term's gain is mostly leak.** It cut MAE about 3.5%, but the ranks are today's. With 3 games per defense, those ranks are largely built from the very games being predicted. `USE_RANK_TERM = false` for now. The popover still shows the row, with that caveat.
- **Open:**
  - Re-run the backtest mid-season (around week 9). Revisit `k_b` and the rank term then, when one week moves a defense's rank much less.
  - Tuning against last season's data is still an open option for a larger sample.

## Verification done

- `dotnet build`, `ng build`, and Vitest: 36 tests, including 13 in `projections.spec.ts`.
- Live league, both modes:
  - Roster rows and total (108.9 ESPN → 108.6 FantasyX).
  - Matchup rows, totals, scoreboard and win probability (58.4% → 56.7%).
  - League tiles, which match the scoreboard.
  - Drawer table, chart and rest of season. Walk-forward values were checked by hand: week 1 equals ESPN, and later weeks use only earlier weeks.
- The setting survives a reload. The tag shows only in FantasyX mode.
- One history request per page load; switching tabs made no new requests.
- A forced history failure shows ESPN's figures with the "unavailable" note, no FantasyX tag, and the position-averages note on win probability.
- At 375px the popover fits and the matchup view doesn't overflow. The roster page already overflows at that width, because of its record meter and 7-column table. That predates this change.
