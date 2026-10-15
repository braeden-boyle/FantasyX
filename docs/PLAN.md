# FantasyX — Plan

## Status (as of 2026-10-15)

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
| v1.8 — Power rankings & playoff odds | #17 `17-add-team-power-rankings-and-playoff-odds` | Built |
| v1.9 — Player rankings | #19 `19-add-player-rankings` | Built and checked against a mock league; live-league checks still to do |
| v1.10 — Matchup UI improvements | #21 `21-matchup-ui-improvements` | Built and checked against a mock API; live-league checks still to do |
| v1.11 — NFL scoreboard | #23 `23-nfl-scoreboard` (PR #24) | Merged; checked against ESPN, a mock API and the live league. Live-game checks still to do |
| Roster suggestions (parent) | #25, sub-issues #26–#28 | Start/sit (#26) merged. Waivers (#27) built. Trades (#28) not started |
| v1.12 — Start/sit assistant | #26 `26-add-start-sit-assistant` (PR #29) | Merged; checked against a mock API and the live league |
| v1.13 — Waiver wire assistant | #27 `27-add-waiver-wire-assistant` (PR #30) | Built; checked against the live league and simulated FAAB / failure cases |

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

---

# v1.8: Power Rankings & Playoff Odds (issue #17) — on `17-add-team-power-rankings-and-playoff-odds`

## Goal

Rank every team by how strong it is rather than by record alone, and show each team's chance of making the playoffs (and of a first-round bye), on the league page and on every roster page.

## Decisions

- **One strength number drives both.** `strength = w·results + (1−w)·roster`, with `w = n / (n + 4)` after `n` completed weeks (`RESULTS_WEIGHT_GAMES`).
  - **Results:** points-for per completed week, from the schedule.
  - **Roster:** the current starters' projected total. A starter projected at 0 (bye, ruled out) is swapped for the best bench player at the same position. IR players are never swapped in.
  - **Projections:** the roster term follows the ESPN / FantasyX setting, and the "FantasyX projections" tag shows on the new columns, card and tiles.
  - **Week 1:** with no results, it's the roster term only.
- **Completed weeks only.** A week counts once ESPN moves `currentMatchupPeriod` on (after stat corrections). Rankings and odds change once a week; neither follows live scores. The roster term still reflects the current roster and lineup.
- **Per-week strength:** each team also gets a strength for every NFL week from this one to the end of the fantasy playoffs: the same results blend, with that week's roster term. This week uses the set lineup. Later weeks use the best lineup the roster (IR aside) can field that week, on that week's projection (lineups get reset, and byes count in the week they fall). A matchup period's strength is the average over its NFL weeks. Before upcoming projections load, or if they fail, every week uses today's strength.
- **Playoff odds:** a seeded (fixed-seed) Monte Carlo of 10,000 runs of the rest of the regular season, the current week included. Each weekly score is `strength that period + spread·z`, so who you play and when both count. The spread is one league-wide figure: the pooled deviation of each team's weekly scores from its own average, with a fallback of 25 before 3 completed weeks.
  - Shows **playoff %** and **bye %** (bye only when the league has byes). Title odds are deferred.
  - **Seeding:** from `mSettings`: the regular-season length (`matchupPeriodCount`), `playoffTeamCount` and `playoffSeedingRule`. `H2H_RECORD` breaks record ties by head-to-head within the tied group, then points for. `TOTAL_POINTS_SCORED` uses points for. Any other rule falls back to points for, with a note under the standings.
  - **Divisions:** with more than one, each division winner is seeded ahead of every other team.
  - **Byes:** the bracket is filled to the next power of two (6 teams: 2 byes).
- **x / y / e tags and 100% / 0%:** once 3 or fewer weeks (and at most 22 games) remain, every remaining win/loss outcome is checked exactly.
  - **x:** clinched a playoff spot. **y:** clinched a bye. **e:** eliminated.
  - Points aren't settled yet, so any tie on record counts against the team for x / y and in its favour for e.
  - Odds read 100% or 0% only when one of those applies. Otherwise they're capped at ">99.9%" / "<0.1%", so the tags and the extremes always appear together.
  - Odds are hidden once the regular season ends. The power rank stays.
- **Draft-day ranking:** each team's best lineup from its own draft picks (dropped players included), on ESPN's week 1 projections, ranked the same way. It's shown on its own "Since Draft Day" card (see UI). The lineup is filled most restrictive slot first (e.g. RB before FLEX), each with the best remaining eligible pick. Week 1 is ESPN-only, so this is the same in both projection modes. It's left out before the draft, or if the draft fails to load.
- **Power score:** each ranking also gives every team a score: its strength as a percentage of the top team's, so 1st is always 100 and a team on 87 projects to score 87% of what the leader does in a week. This Week and Rest of Season each scale to their own leader. The draft-day card stays rank-only.
- **Rest-of-season ranking:** teams ranked by their average per-week strength from this week through the end of the fantasy playoffs, with an arrow for the places each is ahead of (or behind) its rank this week. It's unavailable if upcoming projections fail.
- **Remaining schedule:** the average per-period strength of a team's remaining regular-season opponents, in the weeks they meet, ranked 1st (hardest) to last. It's hidden once the regular season is over.
- **Movement arrow:** today's rank against the rank as of the previous completed week. After week 1, the previous ranking is the draft-day one. That earlier rank uses results through the week before, plus today's rosters with each player's projection for that week from `player-history` (so traded players count for their current team).
- **UI:**
  - **Standings:** new Sched (remaining schedule rank, with a tooltip), Playoffs and Bye columns, plus the x / y / e tag beside the team name. No power rank column.
    - **Phones:** the table scrolls sideways with the seed and team pinned, and the logo is hidden.
  - **Power Rankings component** (`app-power-rankings`): one parent container headed "Power Rankings" (with the projection-source tag), a bordered panel a shade apart from the page, holding two separate cards stacked. Rows are static.
    - **This Week / Rest of Season:** one card with a `p-selectbutton` switch. This Week shows rank, weekly movement, team name and score. Rest of Season shows rank, the change against this week ("vs now"), team name and score, with a legend naming the weeks covered. The switch only appears while rest-of-season weeks remain. A legend under the list names the week the ranking is through, what the arrows compare with ("the ranking after week N−1", or the draft-day ranking after week 1), and the current results / roster weighting.
    - **Since Draft Day** (only with a draft), below it: each team in today's order, with an arrow on a rank track from its draft-day rank to its current one, plus "draft → now". The track runs from last on the left to 1st on the right, so a climb points right (green) and a fall left (red); no change is a grey dot. It's drawn with CSS on each row rather than Chart.js, so it lines up with the list and follows the theme.
    - On phone-width containers (a container query) the nested padding tightens and the draft-day names narrow, to give the track room.
    - **`xl` (1280px) and wider:** both cards under the standings, at the table's full width.
    - **Below `xl`:** a "Power Rankings" button beside the Standings heading goes to `/league/rankings`, which has a Back to League link. The League tab stays active there.
  - **Roster view:** a larger W-L-T line over the record meter, then three matching tiles: Standing ("6th of 10", moved out of the record line), a power rank tile (rank of N, arrow, "Score 72.5 / 100") and a playoff odds tile (playoff %, tag, bye %, and "Schedule: Nth hardest"). Shown on every team's roster, not just yours. Neither tile does anything when clicked.
- **Failure:**
  - `player-history` fails: no arrows, with a note.
  - `/matchups` fails: results only, with a note.
  - The league call fails: the league page shows its error and Retry, and the roster tiles are hidden.

## Backend

- `LeagueDto` gains `RegularSeasonMatchupPeriods`, `PlayoffTeamCount`, `PlayoffSeedingRule` and `Schedule`. The schedule is every regular-season matchup as a `ScheduledMatchupDto`: period, home and away team ids, points, and `Winner` ("HOME" / "AWAY" / "TIE" / "UNDECIDED"). It's the whole schedule if ESPN sends no regular-season length.
- `StandingDto` gains `DivisionId`. `LeagueDto` also gains `ScoringPeriodsByMatchupPeriod` (the NFL weeks in each matchup period, playoffs included).
- `PlayerHistoryDto` gains `Upcoming`: ESPN's projection for the requested scoring period and every later NFL week (through week 18) projected above 0. The card call now filters to all 18 weeks, and week 1 is no longer short-circuited.
- `POST /api/espn/draft` takes `{ leagueId, season, espnS2?, swid? }` and returns `DraftDto`:
  - `Picks`: team id, player id, position and week 1 projection for each pick.
  - `LineupSlots`: each starting slot's name, count and eligible positions, from `rosterSettings.lineupSlotCounts`. IDP, bench and IR slots are left out (`EspnLookups.StartingSlot`).
  - It makes one league call (`mDraftDetail`, `mSettings`) and one `kona_playercard` call for every drafted player, filtered to week 1.
- The ESPN records gain `ScheduleSettings.MatchupPeriodCount`, `PlayoffTeamCount` and `PlayoffSeedingRule`, plus `EspnTeam.DivisionId` and `EspnScheduleEntry.Winner`. They're all nullable, and the league call's views are unchanged.

## Frontend

- `utils/power-rankings.ts` (pure): `powerScores`, `rosterStrength`, `bestLineupTotal` (draft day), `completedScores`, `teamStrength`, `powerRankings`.
- `utils/playoff-odds.ts` (pure): `playoffOdds` (simulation, seeding and the exact check, run in Gray-code order with an early exit), `weeklySpread`, `byeCount`, `seedingTiebreak`, `formatOdds`. Every tunable constant lives here.
- `workers/playoff-odds.worker.ts` runs `playoffOdds` off the main thread (`webWorkerTsConfig` in `angular.json`). It runs inline where workers aren't available.
- `LeagueOutlookService`:
  - Caches the league for the session. The league page calls `refresh()` on each visit and on Retry; other pages call `ensureLoaded()`.
  - Reads rosters from `WeekMatchupsService` and history through `ProjectionsService`, and loads the draft once per import.
  - Exposes `rankings`, `rankOf`, `odds` and `oddsOf`.
  - Only reruns the odds when strengths (per period included) or the schedule change.
  - Exposes `restOfSeason` and `scheduleOf`.
- `ProjectionsService.pastProjectionOf` and `futureProjectionOf`: the active source's projection for a past week (last week's roster term) or an upcoming one (per-week strengths). FantasyX mode applies the bias model to upcoming weeks too.
- `utils/power-rankings.ts` gains `remainingScheduleStrength`; `OddsTeam` gains `byPeriod`.
- Components: `PowerRankingsComponent`, `PowerRankingsPageComponent` (`/league/rankings`), and `RankMovementComponent` (shared by the list and the roster tile). `LeagueComponent` now reads the league from the outlook service.

## Verification

1. Vitest: 28 new tests, 64 in total.
   - Power scores (top team 100, others as a share), strength blend, bench swap and IR rule, the best-lineup fill (flex taken last, empty slots), and remaining schedule strength taken per meeting week.
   - A team weak in one remaining period loses odds, and its opponent that week gains them.
   - Seeded simulation: deterministic, a dominant team near 100%, identical teams summing to P with each near P/N.
   - Exact check on hand-built 4-team leagues: x, e, y, record ties against the team, divisions, and H2H vs points-for tiebreaks.
2. A worst-case timing for the exact check (14 teams, 21 games left) took about 110 ms in Node.
3. UI against a mock API (10 teams, week 12 of 14, 6 playoff teams, H2H):
   - x and e tags with matching 100% / 0%. The odds sum to 6.0.
   - The bye stays below 100% when a team can still be caught.
   - Arrows show, in both ESPN and FantasyX modes.
   - A reversed mock draft gives the expected arrows.
   - Upcoming projections (one team projected 40% higher from week 13, a QB bye in week 13): that team climbs in Rest of Season and gains bye odds, the Sched column ranks schedules, and the roster tile shows "Schedule: 3rd hardest". The switch toggles both ways on real clicks. At 1400px the container sits under the standings at 776px, in both light and dark themes. At 375px the page shows both cards, with a 113px track and no overflow.
   - The card shows under the standings at their width (776px) at 1400px, and the button at 1024px.
   - At 375px: no page overflow, pinned columns opaque on the highlighted row, the rankings route works, and the tiles wrap under the meter.
4. **Still to do on a live league:**
   - Confirm ESPN's field names by checking `/api/espn/league` returns non-zero settings (`matchupPeriodCount`, `playoffTeamCount`, `playoffSeedingRule`, `divisionId`, `winner`), and `/api/espn/draft` returns picks and slots (`draftDetail.picks`, `rosterSettings.lineupSlotCounts`), and `/api/espn/player-history` returns `upcoming` weeks beyond next week (whether ESPN projects every remaining week, not only the next one).
   - Check that the odds look sensible against the standings, and that the tags match ESPN's where it shows them.

## Open questions

- The production build's initial bundle is 1.52 MB, 22 kB over the 1.5 MB warning budget. It's a warning, not an error.
- Remaining-game ties aren't enumerated by the exact check (W/L only), which only matters in leagues that allow ties.

---

# v1.9: Player Rankings (issue #19) — built on `19-add-player-rankings`

## Goal

FantasyX's own ranking of every player who matters in the league, rostered or available, by **rest-of-season value over replacement**: how many more points a player is projected to score from now to the end of the fantasy season than a freely available player at the same position. It's built on this league's scoring and lineup, and it follows the ESPN / FantasyX projection setting. It answers the mid-season questions: who to trade for, which pickup is worth a claim, and how your own players compare with the rest of the league.

## Decisions

- **Metric: rest-of-season value over replacement.**
  - **Rest-of-season points (ROS):** the sum of a player's projection over every NFL week from the current scoring period through the last week of the fantasy playoffs (the last week in `ScoringPeriodsByMatchupPeriod`). It's the same window as v1.8's Rest of Season power ranking. A week ESPN doesn't project the player (bye, ruled out) counts 0, so byes and injuries already lower the total. Playoff weeks count the same as regular-season weeks, on purpose: that way value means the same for every owner and for free agents. Weighting them by v1.8's playoff odds would make value depend on the team, and leave it undefined for free agents.
  - **Projections** come from the active source, the same way as v1.8's per-week strengths: ESPN's upcoming projections, with the bias model applied in FantasyX mode.
  - **Replacement level, per position:** first count how many players at each position start across the league. That's each dedicated slot's count × the number of teams. Flex slots (RB/WR/TE, OP and so on) are then filled from the whole pool, best remaining eligible player first, in the same most-restrictive-first order as `bestLineupTotal`. The replacement level is the mean ROS of the `REPLACEMENT_DEPTH` (3) players just below the last starter at that position. Averaging a few players means one injured or unprojected player doesn't move the whole position.
  - **Value** = ROS − replacement level. The overall rank is by value, so positions can be compared. The position rank (e.g. RB12) is by ROS.
  - Replacement is worked out from projections only. Who rosters a player doesn't matter, so the value means the same thing for a rostered player and a free agent.
  - **Not done:** a separate replacement level for each week. It would credit players who fill byes, but it's much more work for a small gain. Revisit if the rankings look wrong around bye weeks.
- **Player pool:** every rostered player in the league (from the cached week of matchups, benches and IR included), plus the top `AVAILABLE_PER_POSITION` (50) free agents and waiver players at each starting position in the league's slots, by percent owned. The available players are needed for the replacement level to be right. Without them, the replacement level is set by the worst rostered starters, not by what's actually on waivers. They're fetched per position because a single league-wide list by percent owned can leave too few kickers and D/ST (both low-owned), or too few players at any position in a deep league. Players outside the pool aren't ranked.
- **Positions and slots** come from the league's lineup settings (see Backend), so a league without kickers ranks no kickers, and a superflex league's OP slot pulls QBs into the starter count. IDP slots are still ignored, as in v1.8.
- **Season-to-date context**, shown next to the value but not used in it: points, games and average per game, from `player-history` weeks.
- **Current and rest of season only.** The rankings show today's projections and nothing else. There are no movement arrows and no past rankings in the UI.
- **Rankings change** when the scoring period changes or the projection setting is switched. They don't follow live scores.
- **Snapshots, saved weekly on a schedule:** a GitHub Actions workflow saves the league's rankings every Wednesday at 14:00 UTC, in both projection modes (see Scheduled capture). By then ESPN has moved to the new week, most leagues have processed waivers, and Thursday's game is still a day away. Every week is captured at the same point, which is what a later backtest of value against actual scores needs. ESPN doesn't keep old projections, so this is the only way to have them.
  - One snapshot per league, season, scoring period and projection source. The first save wins and a later one for the same key writes nothing.
  - Only the scheduled job saves. Opening the Players page never writes, and nothing in the app reads snapshots yet.
  - Only complete rankings are saved: not when the available players failed (rostered only), and not when the rankings are unavailable. In that case the run fails.
  - A failed run shows red in Actions and emails the repo owner. It can be re-run by hand (`workflow_dispatch`). A re-run later in the week is still saved, and `CreatedAtUtc` shows when it was taken.
- **UI:**
  - **Players tab** (`/players`) after League in the header nav, icon-only on phones like the others.
    - A `p-table`. Both rankings start with rank and player (avatar, name, position · NFL team, injury tag) and end with the fantasy team (logo and abbreviation, or an **FA** / **WA** tag). In between:
      - **This Week:** the NFL opponent ("vs KC", "@ KC" or BYE), a Matchup star rating (the same 1–5 stars as the roster view, from the opponent's current rank against the position), this week's projection (active source), points so far, season average, and value.
      - **Rest of Season:** two strength-of-schedule columns as stars, **ROS SOS** over every remaining week of the window, playoffs included, and **Playoff SOS** over the fantasy playoff weeks alone (hidden when ESPN doesn't give the regular season's length). Each is the opponents' average rank against the position, byes and unranked opponents left out. Then ROS points, value, and season average.
      - Added after the first build. This week's points are as of when the rosters loaded, like the rest of the rankings.
    - A **This Week / Rest of Season** switch (`p-selectbutton`, Rest of Season by default). This Week ranks the same way over a one-week window: value is this week's projection over this week's replacement level, position ranks follow this week's projection, and the ROS column is hidden (it would repeat Proj). Snapshots and the drawer stay rest of season. Added after the first build.
    - No position rank column (dropped after the first build): filtered to one position, the # column shows the rank at that position instead (the WR1 reads 1 whatever their overall rank). All and FLEX show the overall rank. The drawer still shows the position rank.
    - Filters: position (`p-selectbutton`: All, each position in the league's slots, and FLEX), availability (All / Rostered / Available), and a name search. Sorted by value by default, and every column can be sorted.
    - Paginated at 50 rows. Your players' rows are highlighted.
    - Clicking a row opens the existing player drawer. `/api/espn/player` already takes any player id, free agents included.
    - A legend under the table names the weeks covered and the replacement levels ("RB replacement: 41.3 pts"). The "FantasyX projections" tag shows by the heading.
    - Phones: the table scrolls sideways with the rank and player columns pinned, like the standings.
  - **Player drawer:** the summary gains "FantasyX rank 34th · RB12 · Value +41.2", or "Not ranked" for a player outside the pool.
  - **Roster view:** unchanged. The position rank shows in the drawer only (decided after the first build, which put it in the position · team line).
- **Failure:**
  - Available players fail: rankings show for rostered players only, with a note that replacement levels are estimated from rostered players.
  - History or upcoming projections fail: the rankings are unavailable, with a note. ESPN figures are never shown under a FantasyX label.
- **Deferred:** a trade analyzer, waiver suggestions ("better than your starter"), weekly start/sit rankings, playoff-weighted or team-specific value, dynasty/keeper value, and ranges from v1.6's spreads.

## Backend

- `LeagueDto` gains `LineupSlots`, mapped the same way as `DraftDto.LineupSlots` (`EspnLookups.StartingSlot`). The league call already requests `mSettings`, so no new view is needed. The rankings no longer depend on the draft loading.
- `POST /api/espn/available-players` takes `{ leagueId, season, scoringPeriod, positions, perPosition, espnS2?, swid? }` and returns `AvailablePlayerDto[]`. `positions` is the league's starting position ids (from `LineupSlots`) and `perPosition` is 1–100. It makes one ESPN call per position in parallel, then merges the results and drops duplicate player ids. Each player has:
  - Identity, matching `PlayerDto`: `PlayerId`, `FullName`, `Position`, `ProTeam`, `InjuryStatus`, `HeadshotUrl`, `IsTeamLogo`.
  - `Status` ("FREEAGENT" / "WAIVERS"), `PercentOwned`, and `Points`: what they've scored in the requested scoring period so far.
  - `Weeks` and `Upcoming`, in `PlayerHistoryDto`'s shape and under the same rules, so the frontend models them the same way.
  - `Schedule` (also added to `PlayerHistoryDto`): the current NFL team's games from the scoring period through week 18, each with the opponent, home/away and the opponent's current rank against the player's position. It drives the matchup and strength-of-schedule columns.
- **ESPN call, to confirm first (spike):** for each position, one `kona_player_info` call with an `x-fantasy-filter` of `filterStatus` FREEAGENT + WAIVERS, `filterSlotIds` for that position, `sortPercOwned` descending, `limit` = `perPosition`, and `filterStatsForScoringPeriodIds` 1–18. v1.6 found that ESPN answers 400 to `limit` on a `kona_playercard` call filtered by `filterIds`. This view and filter are different, but check it first.
  - If `kona_player_info` returns no weekly stats, fall back to two steps: those calls for ids only, then the existing `player-history` path for those ids.
  - Either way, the per-week mapping (actuals, projections, opponent rank via `GameFor`) is pulled out of `GetPlayerHistory` into a helper both endpoints share.
- **Snapshot storage**, following v1.1's EF Core + Supabase pattern (`Data/FantasyXDbContext.cs`):
  - `Models/PlayerRankingSnapshot.cs` → `player_ranking_snapshots`: `Id`, `LeagueId`, `Season`, `ScoringPeriod`, `ProjectionSource` ("ESPN" / "FANTASYX"), `FirstWeek`, `LastWeek`, `ReplacementLevels` (jsonb, position → points) and `CreatedAtUtc`, with a unique index on (`LeagueId`, `Season`, `ScoringPeriod`, `ProjectionSource`).
  - `Models/PlayerRankingSnapshotEntry.cs` → `player_ranking_snapshot_entries`: `SnapshotId` (FK, cascade delete), `PlayerId`, `Position`, `FantasyTeamId` (null for free agents), `Status` ("ROSTERED" / "FREEAGENT" / "WAIVERS"), `Rank`, `PositionRank`, `RestOfSeasonPoints`, `Value` and `WeeklyProjections` (jsonb, week → points, so a backtest can compare any part of the window). The key is (`SnapshotId`, `PlayerId`).
  - `POST /api/player-ranking-snapshots` (`PlayerRankingSnapshotsController`) writes the snapshot and its entries in one transaction. If one already exists for that key, it returns 200 and writes nothing, so the first write wins. There's no GET yet.
  - The endpoint needs an `X-Capture-Key` header that matches the `Snapshots:CaptureKey` setting (user-secrets locally, an env var in the workflow). A missing or wrong key gets 401. It returns 404 when no key is configured, so a future hosted backend doesn't expose an open write endpoint.
  - Migrations: `AddPlayerRankingSnapshots`, then `EnablePlayerRankingSnapshotRls`, which enables RLS with **no policies** on both tables, as v1.1's Security notes require for every new table. Check Supabase's security advisors afterwards.
- Sample requests for both endpoints go in `FantasyX.Backend.http`.

## Frontend

- `utils/player-rankings.ts` (pure), with every tunable constant (`REPLACEMENT_DEPTH`, `AVAILABLE_PER_POSITION`):
  - `restOfSeasonPoints(weeks, projectionFor)`
  - `startersByPosition(slots, teamCount, pool)`: the dedicated + flex fill. The slot ordering is shared with `bestLineupTotal`, extracted from `power-rankings.ts`.
  - `replacementLevels`, `playerValues`, `rankPlayers` (overall and position ranks)
  - `buildPlayerRankings(input, source, horizon = 'restOfSeason')`: the whole pipeline from plain API data (league, rosters, histories, available players) to the ranked list, replacement levels and weeks covered. Both `PlayerRankingsService` and the capture script call it, so the saved rankings are exactly what the page shows.
  - `snapshotPayload(rankings, …)`: maps a result to the snapshot request.
- `utils/projections.ts` gains the upcoming-week projection for any player (`upcomingProjection`): a player id, position and their own history in, the active source's projection out. The bias is per player, so a free agent needs only its own weeks. The rank term's slope stays fitted on rostered players (and is off anyway, `USE_RANK_TERM = false`). `ProjectionsService` wraps it, and the capture script calls it directly.
- `AvailablePlayersService`: a session cache keyed on the import and scoring period, the same pattern as `PlayerHistoryService`. It sends the league's starting positions and `AVAILABLE_PER_POSITION`, and is only loaded when the rankings are wanted.
- `PlayerRankingsService` (loaded by the Players page and by the drawer when it opens):
  - Combines the league (slots, team count, weeks per matchup period) from `LeagueOutlookService`, rosters and owners from `WeekMatchupsService`, upcoming projections through `ProjectionsService`, and `AvailablePlayersService`.
  - Exposes `rankings` (rest of season), `rankingsFor(horizon)` for the switch, `rankOf(playerId)` and a status. Each ranking is only built when read. It has an `ensureLoaded()` for the Players page, drawer and roster to call.
- Components: `PlayerRankingsComponent` (`/players`), the nav tab, and the drawer summary line.

## Scheduled capture

- `frontend/scripts/capture-player-rankings.ts`, run with `tsx` (new dev dependency) as `npm run capture:rankings`. It imports only `utils/` and `models/`, never Angular.
  - Reads `API_URL`, `LEAGUE_ID`, `ESPN_S2`, `SWID` and `CAPTURE_KEY` from the environment. `SEASON` defaults to the current NFL season (this year from March on, last year before).
  - Fetches through the backend, the same endpoints as the app: `league`, `matchups` for the current week, `player-history` for every rostered player, and `available-players`. ESPN calls are retried 3 times with backoff.
  - Runs `buildPlayerRankings` for ESPN and FantasyX, and posts both snapshots.
  - Exits 0 with "nothing to capture" before week 1 or after the last playoff week. It exits non-zero on any failure or incomplete ranking.
  - Logs only counts and ranks, never cookies or other secrets: the Actions logs are public on this repo.
- `.github/workflows/capture-player-rankings.yml`:
  - Triggers: `schedule: '0 14 * 9-12,1 3'` (Wednesdays 14:00 UTC, September–January) and `workflow_dispatch` for manual runs.
  - Steps: check out; set up .NET 8 and Node; `npm ci` in `frontend`; start the backend in the background (`dotnet run`, `ConnectionStrings__FantasyX` and `Snapshots__CaptureKey` from secrets); wait for it to answer; run the script; stop the backend.
  - Repo secrets: `FANTASYX_DB_CONNECTION` (the session-pooler string, as in v1.1), `ESPN_S2`, `ESPN_SWID`, `FANTASYX_LEAGUE_ID` and `SNAPSHOT_CAPTURE_KEY`. GitHub masks them in logs.
  - The saved-credentials table isn't used: its Data Protection keys only exist on the dev machine. The cookies in secrets are a second copy, to update by hand when ESPN expires them. An expired cookie shows up as a failed run.
  - GitHub only runs scheduled workflows from `main`, so it starts once v1.9 is merged. On a public repo it turns schedules off after 60 days without any repo activity, so it may need turning back on before each season.

## Verification

1. **Spike:** the `kona_player_info` call on a live league. Confirm that `limit` is accepted, the pool is sorted by percent owned, waiver players are included, and weekly stats and projections come back. Then confirm that the merged response has at least `REPLACEMENT_DEPTH` + 10 unrostered players at every starting position, K and D/ST included. Record the result in this section before building the rest of the endpoint.
   - **Result so far (2026-10-05), on ESPN's default player pool** (`leaguedefaults/3`, which needs no league): `limit` is accepted (5 and 100 came back exactly), the list is sorted by percent owned, `status` (FREEAGENT / WAIVERS) is on each entry, and every player has weekly actuals and projections (`statSplitTypeId` 1) for weeks 1–18. A bye week comes back as a 0 projection. That pool has all 32 D/STs. `mPositionalRatings` returns nothing there, since it isn't a league. So the single-step call was built, without the two-step fallback.
   - **Confirmed on the live 14-team league (2026-10-05, week 4):** waiver players come back alongside free agents (on a Monday most are on waivers), `positionAgainstOpponent` comes back with `kona_player_info` (free agents get opponent ranks), and every position has at least `REPLACEMENT_DEPTH` + 10 unrostered players: 50 at QB, RB, WR and TE, 44 at K and 17 at D/ST.
2. **Vitest:**
   - ROS sums over the right weeks, with byes as 0.
   - The starter count for a standard league (QB 1, RB 2, WR 2, TE 1, FLEX 1, 10 teams): the flex goes to the best remaining RB/WR/TE.
   - Superflex pulls QBs into the starter count, and a league without K ranks no kickers.
   - The replacement level is the mean of the next `REPLACEMENT_DEPTH` players.
   - The player at replacement level has a value of about 0, and every starter has a value above 0.
   - Ranks are stable when values tie.
   - `snapshotPayload` includes every ranked player (no team id and the right status for free agents), and refuses rostered-only or failed rankings.
   - The capture script's season default (March on → this year) and its "nothing to capture" window.
3. **Live league, both projection modes:**
   - The top 10 at each position should look sensible against ESPN's own rest-of-season rankings. Record the rank correlation per position here.
   - Each replacement level should sit close to what the best waiver player at that position is projected for.
   - Switching the setting re-ranks the table, and the tag follows it.
4. **UI:** filters, search, sorting and pagination; your rows highlighted; FA / WA tags; the drawer opens for a free agent; the drawer and roster ranks match the table; and no page overflow at 375px.
5. **Failures:** an available-players failure (rostered only, with the note) and a history failure (unavailable, with the note).
6. **Snapshots:**
   - Run `dotnet ef database update`. Both tables show RLS enabled with no policies, and Supabase's security advisors are clean.
   - The endpoint returns 404 with no capture key configured, and 401 with a wrong key.
   - Run `npm run capture:rankings` against the local backend: two snapshot rows for the period, and their top entries match the Players page in each mode. Run it again: still two, unchanged. Loading the Players page writes nothing.
   - After merging: add the repo secrets, trigger the workflow once by hand, and check it goes green, writes nothing new for an already-saved week, and prints no secrets.

## Open questions

- **Backtest:** when and how to compare the stored snapshots with what players actually scored. That's its own milestone, once a season's worth is collected.
- **More than one league:** the workflow captures the one league in its secrets. Capturing more would need a list of leagues (and their cookies) somewhere the job can read.
- **Hosting:** once the backend is hosted, the workflow could call it instead of starting its own copy, and could read the saved credentials if the Data Protection keys move with it.
- **Snapshot retention:** each snapshot is roughly the rostered players plus 50 per position, per league, period and mode. That's small, but it grows every season with nothing pruning it.

## As built

- **Backend:**
  - `available-players` takes positions by **name** ("QB", "RB", …), not slot ids, since `LineupSlots` carries names. `EspnLookups.PositionSlotId` maps each to its slot for `filterSlotIds`. An unknown position gets a 400.
  - The per-week mapping shared by both endpoints is `PlayerWeeks`.
  - Snapshot saves answer 201 when written and 200 when the key already exists, both with `{ snapshotId, created }`. A concurrent duplicate that hits the unique index is treated as "already exists".
  - The capture key is checked by `RequireCaptureKeyAttribute`, an authorization filter, so it runs before the body is validated. It compares SHA-256 hashes in constant time.
  - The jsonb columns are dictionaries converted to and from JSON strings, so Npgsql's dynamic JSON doesn't need switching on. The foreign key and unique index have explicit names (`fk_player_ranking_snapshot_entries_snapshot`, `ix_player_ranking_snapshots_key`), since EF's defaults run past Postgres's 63 characters.
- **Frontend:**
  - `slotFillOrder` (`power-rankings.ts`) is the shared slot order. `bestLineupTotal` and `startersByPosition` both use it. `LeagueOutlookService`'s per-week strengths now take the league's `lineupSlots`, not the draft's.
  - `upcomingProjection(source, espn, history, week)` is the shared upcoming projection. `ProjectionSource` moved into `utils/projections.ts`, so the capture script doesn't import an Angular service. `SettingsService` re-exports it.
  - The Players page sorts with its own header buttons, not `p-table`'s sorting. That way each column's first click goes the useful way (Value, ROS and Avg descending; rank and name ascending), and the drawer steps through the rows exactly as shown, turning the table's page as it goes. Players with no games sit at the bottom by average, in either direction.
  - The `/players` route is lazy-loaded, which keeps its table and filters out of the initial bundle.
  - The drawer takes a `DrawerPlayer`: a roster row, or a ranked player with no roster row. For a free agent, the header's "This week" line comes from the detail once it loads.
  - On phones, the header's icon-only tabs narrow so all four fit at 375px. The position filter scrolls sideways when a league's positions don't fit; a standard league's are 50px too wide.
- **Capture:** the script's pure parts live in `scripts/capture-helpers.ts` (`defaultSeason`, `captureWindow`, `withRetries`), and Vitest also runs `scripts/**/*.spec.ts`.
  - "Before week 1" means no scoring period yet, or no players rostered (before the draft).
  - Only network errors and 5xx answers are retried, 3 times, 2 / 4 / 8 s apart. A 4xx (expired cookies, wrong key) fails at once.
  - It logs the week, counts, and each mode's top 5 with ranks.
  - The workflow runs the built backend DLL from `backend/`, so it finds `appsettings.json` and the saved process id is the app's. It prints the backend's log tail only when a step fails.

## Verification done

- `dotnet build`, `ng build` (initial bundle 1.54 MB, 41 kB over the warning budget, up from 22 kB), and Vitest: 91 tests. That's 17 in `player-rankings.spec.ts`, 3 more in `projections.spec.ts`, and 7 in `capture-helpers.spec.ts`.
- Migrations applied to Supabase. Both tables have RLS enabled with no policies. The security advisors show only the INFO-level "RLS enabled, no policy" notice, which is on every table by design.
- Snapshot endpoint: 404 with no key configured, 401 with a missing or wrong key, and 400 for an invalid body. `available-players` answers 400 for an unknown position, and ESPN's 401 for an unreadable league.
- **Against a mock API** (10 teams, week 5, 14-week regular season, playoffs weeks 15–17, standard lineup, 160 rostered and 174 available players):
  - Filters, search, sorting, pagination and `aria-sort` work. Your rows are highlighted, and FA / WA tags show.
  - The drawer opens for a waiver player, with this week's game from its detail. It steps across pages. Its rank line matches the table.
  - Switching to FantasyX re-ranks the table, moves the replacement levels, and shows the tag.
  - Available players failing: rostered-only, with the note. History failing: unavailable, with the note, no FantasyX label, and no roster ranks.
  - At 375px, no page overflow, and the rank and player columns stay pinned.
  - One history request and one available-players request per page load.
- **Capture, end to end** (mock ESPN data, the real backend and Supabase):
  - The first run saved two snapshots of 334 entries each, 174 of them unrostered. Each mode's top 5 matched the Players page.
  - A second run wrote nothing.
  - A wrong key exits 1, and so does an available-players failure (after 3 retries). Loading the Players page made no snapshot calls.
- **Still to do on a live league:**
  - Step 3: the top 10 at each position against ESPN's rest-of-season rankings, with the rank correlation recorded here, and replacement levels against the best waiver players.
  - A capture run against the real league. Then, after merging, the repo secrets and one manual workflow run.
- **Live league, after the schedule columns (2026-10-05):** both views show real opponents and stars, for K and D/ST too. This week's opponent and stars match the roster view for all 15 players on a roster, a D/ST and a bye included.

---

# v1.10: Matchup UI improvements (issue #21) — on `21-matchup-ui-improvements`

## Goal

Make the matchup view useful while games are on. Once a player's game starts, the kickoff time gives way to their stat line, an in-progress game shows a live indicator with the clock, scores refresh on their own, and each side shows how many starters are still to play.

## Decisions

- **Live state source:** ESPN's public NFL scoreboard (`site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`), because the fantasy API has no game clock and `StatsOfficial` can lag the final whistle. It's best-effort: if it fails, the view falls back to the kickoff time (live after kickoff, then final after the game length plus an hour).
- **Spike (2026-10-07, week 4):** competitor ids are ESPN team ids, the same numbering as the fantasy `proTeamId` (ATL 1, BAL 33, HOU 34, ...). Status is on each event: `period`, `displayClock` and `type.{name, state, completed}`, with `state` one of `pre`/`in`/`post`. The `dates={season}&seasontype=2&week={week}` query returns that NFL week's 16 games.
- **Player cell:** upcoming games are unchanged. Live games show a pulsing red dot, the clock on `sm+` ("Q3 4:12", "Half", "End Q1", "OT 2:05"), the opponent and the stat line. Final games show the opponent and stat line, or "Final" without stats. The line truncates, with the full text in its tooltip.
- **Auto-refresh:** about once a minute while any starter in the week is live, otherwise a minute after the next kickoff (never sooner than a minute after the last fetch). It pauses while the tab is hidden, and an overdue refresh fires on return. A failed automatic refresh keeps the scores on screen and retries a minute later. A manual Refresh still shows errors as before.
- **Starters progress:** "4 to play · 2 live · 3 done" under each scoreboard score, with byes counted as done.

## Backend

- `PlayerDto` gains `StatLine`, `GameState` and `GameDetail`. `GameFinal` is now `StatsOfficial || GameState == "post"`, so win probability settles at the real final.
- `EspnStatColumns.FormatSummary` builds the stat line from the week's actual `Stats` map, leaving out stats the player didn't record. Rushing and receiving yards are combined into one scrimmage-yards figure, and passing, rushing and receiving TDs into one count: "14 CAR, 3 REC, 93 YD, 2 TD", or "5 REC, 1 CAR, 81 YD, 1 TD" for a receiver. A QB's passing yards are labelled apart from their rushing yards: "18/27, 245 PASS YD, 3 CAR, 12 RUSH YD, 3 TD, 1 INT". Kickers and D/STs read "FG 2/3, XP 3/3" and "2 SACK, 1 INT, 14 PA" (points allowed always shown).
- `FetchNflGamesAsync` runs after the league call (it needs the scoring period), using an absolute URL on the existing client with no league cookies. It's only applied to players with a fantasy schedule game, so a bye never reads as live. The roster endpoint passes no scoreboard, so the new fields are null there.

## Frontend

- `gamePhase(player, now)` in `utils/player-format.ts`: `none`, `upcoming`, `live` or `final`.
- `utils/live-refresh.ts`: `nextRefreshDelay`, `phaseCounts` and `formatPhaseCounts`.
- `WeekMatchupsService.fetchedAt` records when the cached week was fetched. The matchup view judges games (and win probability) against it instead of when the view opened.

## Verification

1. `dotnet build`, `ng build` and Vitest (106 tests, 11 of them new in `live-refresh.spec.ts`).
2. Against a mock API with games final, in progress and still to come: each cell state rendered as above, the counts added up to the starters, polling was about once a minute while live, and there was no overflow at 375px.
3. **Still to do on a live league:** `POST /api/espn/matchups` during a game window. Check `statLine`, `gameState` and `gameDetail` for pre, in and post games, a D/ST and a K included, and that the stat lines match ESPN's.

## Follow-up: possession highlight (decided and built 2026-10-07; live check pending)

While a game is live, highlight the rows of players whose team has the ball, the way ESPN's matchup page does.

**Source:** ESPN's NFL scoreboard (already fetched by `FetchNflGamesAsync`) very likely carries `competitions[0].situation` during in-progress games: `possession` (a team id, the same numbering as `proTeamId`), `isRedZone`, `downDistanceText`, timeouts and `lastPlay`. The evidence is that the open-source Home Assistant TeamTracker integration reads `situation.possession` from this same endpoint (`custom_components/teamtracker/set_values.py`). Not yet seen first-hand: on 2026-10-07 no game was live, finished and upcoming games carry no `situation` block, and ESPN's core per-game `situation` endpoint (`sports.core.api.espn.com/.../competitions/{id}/situation`) has no possession field after the final whistle.

**Decisions (asked and answered 2026-10-07):**

1. **What it means:** the highlight follows team possession. It doesn't show whether a particular player is on the field; backups, the second RB and so on lighting up too is fine.
2. **How it looks:** a highlight on the player's row in the matchup table. No icon or label. Gold (`--p-amber-400`) for has the ball, red inside the 20. A small legend under the starters table explains both (and the D/ST rule), shown only while a game in the matchup is live.
3. **Which players:** QB, RB, WR, TE and K are highlighted when their team has the ball; the K is treated as offense. D/ST is highlighted when the opponent has the ball.
4. **Freshness:** the existing 60s auto-refresh is enough. No faster possession-only polling or new endpoint.
5. **Red zone:** a stronger red-zone variant when the team with the ball is inside the 20. For a D/ST, that means the opponent is in the red zone.

**Still to do (Thursday Night Football, 2026-10-08):** the feature was built before ESPN's live `situation` block could be seen. Capture the live scoreboard a few times during the game and record here:
- the type and format of `situation.possession`
- whether it's blank or missing during kickoffs, timeouts, reviews, between quarters and at halftime
- `isRedZone` and `downDistanceText`

No row is highlighted wherever `possession` is missing.

**As built:**
- **Backend:** an `EspnNflSituation(Possession, IsRedZone)` record on the scoreboard's competition, read only while the game is in progress. `Possession` is read as raw JSON and accepted as a string or numeric team id, because its live shape is unconfirmed; anything else, or a blank, means no one has the ball. `PlayerDto` gains `PossessionTeam` (the pro team abbreviation) and `RedZone`.
- **Frontend:** `fieldState(player, now)` in `utils/player-format.ts` returns `none`, `ball` or `redZone` (unit tested). Player cells get `.has-ball` and `.red-zone` classes: a tinted background plus an accent bar on the cell's outer edge, red for the red zone. The state is also added to the cell's `aria-label`, because the highlight is visual only.
- **Mock proxy:** live games flip possession every few refreshes, with the red zone sometimes on.

**Verified so far:**
- `dotnet build`. The situation record parsed string, numeric, blank, missing and null `possession` correctly.
- `ng build`, and Vitest: 110 tests, 4 new for `fieldState`.
- On the user's league through the mock proxy:
  - Offense and kickers are highlighted with their team's possession, and D/STs with the opponent's. The red-zone variant shows.
  - Games without a possession, and upcoming or final games, stay plain.
  - The accent bar is mirrored on the right team.
  - Both themes look right, with no overflow at 375px.

---

# v1.11: NFL scoreboard (issue #23) — on `23-nfl-scoreboard`

## Goal

Show the real NFL games behind the matchup. The week's slate runs as a ticker on the matchup view, and each game has its own page: the last play, the top fantasy players, team stats, the box score and the scoring summary. It's the complement that explains the matchup's state.

## Decisions (asked 2026-10-12)

- **Placement:** a horizontally scrolling strip of mini scores above the matchup scoreboard, under the matchup switcher, like ESPN's ticker. There's no new nav tab.
- **Game page:** its own lazy route, `/matchup/game/:gameId`, with the same strip at the top. `?team=` carries the matchup it was opened from (left out for your own), so Back returns there and the strip's counts follow it. The Matchup tab stays lit.
- **Weeks:** the current scoring period only.
- **Fantasy tie-in:**
  - Each card counts the starters on both sides of the viewed matchup ("GURU 2 · SCAR 1"), and dims games neither side has anyone in.
  - Top fantasy players use league scoring.
  - Cards reuse v1.10's possession tint (gold, red in the red zone).
  - There are no per-player owner tags.
- **No NFL logos** (changed after the first build): teams are drawn in their colours, as a dot on the strip and a badge in the game header. See Frontend.
- **Ownership by colour** (changed after the first build): on the game page, players on either side of the viewed matchup get a coloured dot with a legend, replacing headshots and fantasy-team logos. See Frontend.

## Spike (2026-10-12, week 5)

- **Scoreboard** (`site.api.espn.com/.../nfl/scoreboard?dates={season}&seasontype=2&week={week}`):
  - Each event has `id` and `date` (no seconds: "2026-10-16T00:15Z").
  - Competitors have `homeAway`, `score` (a string) and `records[0].summary`.
  - The event also has `status.type.shortDetail` ("Final/OT", "10/12 - 8:15 PM EDT") and `broadcasts[].names`.
  - `week.teamsOnBye` lists the teams on bye.
- **Summary** (`.../nfl/summary?event={id}`, about 590 KB):
  - `header.competitions[0]` has the status and `broadcasts[].media.shortName`. Its competitors have `record` (not `records`), `linescores` and a `possession` bool.
  - The box score has `boxscore.teams[].statistics` (label/displayValue pairs) and `boxscore.players[].statistics[]`: categories with `labels`, `athletes` and `totals`.
  - `drives.previous[]` holds each drive's `description` and `plays[]`; each play has `start.downDistanceText`.
  - `scoringPlays[]` carries the team and the running score.
  - Athlete ids equal fantasy player ids.
  - Before kickoff there are no drives, and the box score has 8 season-average team stats and no players.
  - A bad id answers 404.
- **Fantasy pool:** `kona_player_info` takes `filterProTeamIds`, `filterSlotIds`, `filterStatsForScoringPeriodIds`, `sortPercOwned` and `limit` together. It returns both teams' players with their week actuals and projections, D/ST and K included. Confirmed on `leaguedefaults/3`, then on the real league.
- **Still to see live** (MNF 2026-10-12, or TNF 2026-10-15):
  - the scoreboard's `situation.{possession, isRedZone, downDistanceText, lastPlay}`
  - whether the summary has a top-level `situation` and `drives.current`
  
  Until then, the uncertain fields are read as raw JSON, so an unexpected shape reads as missing. Seeing them live also settles v1.10's open possession check.

## Backend

- **Scoreboard:**
  - `EspnNflScoreboard.cs` gains nullable fields only.
  - `FetchNflGamesAsync` became `FetchNflScoreboardAsync`. It returns the per-team states (unchanged for player rows), the games in kickoff order, and the bye teams.
- **Week of matchups:** `WeekMatchupsDto` gains `NflGames` (`NflGameDto`) and `TeamsOnBye`, both empty when the scoreboard fails. Teams are identified by id, abbreviation and name; there are no logo URLs.
- **`POST /api/espn/nfl-game`** takes `NflGameRequest { leagueId, season, scoringPeriod, eventId (digits only), espnS2?, swid? }` and returns `NflGameDetailDto`. It makes two calls, one after the other:
  1. The public summary (`EspnNflSummary.cs`). A 400 or 404 from ESPN maps to 404, and anything unreadable to 502.
  2. The league's `kona_player_info` for both teams: limit 60, sorted by percent owned, offensive positions plus K and D/ST.
     - Players who didn't play or were ruled out are dropped (`IsMissedGame`).
     - The rest are sorted by points once the game has started, and by projection before.
     - `StatLine` uses `FormatSummary`.
     - If this call fails, `FantasyPlayers` is null and the rest still loads.
- **Last play:** the last play of `drives.current`, else of the last previous drive, else `situation.lastPlay`.
- **Possession:** `situation.possession`, else the header competitor flagged `possession`.
- **Down & distance:** `situation.downDistanceText`, else the current drive's last play.
- **Team stats:** a whitelist in a fixed order, with "Red Zone (Made-Att)" shown as "Red Zone". Empty before kickoff.
- **Box score:** passing, rushing, receiving and kicking, away team first. Empty before kickoff.

## Frontend

- **`utils/nfl-games.ts`:** `nflGamePhase`, `teamFieldState`, `playersInGame`, `stripFocusIndex`, `winner`, and `periodName` / `periodShort`. Tested in `nfl-games.spec.ts` (15 tests).
- **`live-refresh.ts`:** `nextRefreshDelay` also takes NFL games and an interval.
  - The matchup view passes the week's games, so a live game with no league starters still keeps the strip fresh.
  - The game page uses `GAME_REFRESH_INTERVAL_MS` (30 s).
- **`NflTeamMarkComponent`:** an NFL team drawn in its colours from `utils/pro-team-colors.ts`, with no logo. The primary colour is ringed in the secondary, so dark teams still show on a dark background. It's a dot on the strip, and a badge with the abbreviation in the game header. It's decorative, since the team's name or abbreviation always sits beside it.
- **`NflGamesStripComponent`:**
  - Opens centred on the current game, else the first live game, else the next to kick off. It only re-centres when that target changes, so refreshes don't move it.
  - Status line: live dot and clock, kickoff time, or "Final" / "Final/OT".
  - The winner is bold, the team with the ball is tinted, and there's a counts row and a "Bye" entry.
  - Each card has a full `aria-label`.
- **`NflGameService`:** a session cache per import, week and game. It keeps each fetch time, for timing live refreshes.
- **`NflGameComponent`** (lazy, 26 kB):
  - **Strip:** the week's strip, with the current game swapped for this page's fresher copy.
  - **Back button:** an outlined pill like the roster page's "View Matchup", naming the matchup it returns to ("Back to GURU vs SCAR", or "Back to matchup" before the week loads or on a bye). Refresh sits opposite.
  - **Header:** team badges, records, scores, clock, down & distance, and the possession tint.
  - **Linescore,** then a Last play / Final / Kickoff card.
  - **Top fantasy players:** the top 10, then "Show all".
    - Projections go through `ProjectionsService`, so FantasyX mode applies.
    - A non-rostered player gets ESPN's figure, since the model has no history for them.
  - **Ownership dots:** every player rostered by either side of the viewed matchup gets a dot, in both the fantasy list and the box score.
    - Colours: the theme's primary (emerald) for the side the matchup is viewed from, violet (`--p-violet-400`) for the opponent.
    - Filled for a starter, a ring for the bench.
    - A legend above both lists reads "Your players · Opponent's players · On the bench", or uses the two teams' names from someone else's matchup.
    - Each dot's tooltip and accessible label say "Starting for …" or "On the bench for …".
    - Players on neither side get an invisible dot, so names stay lined up.
  - **Team stats, box score and scoring summary:** the box score has a `p-tabs` per team, with QBR, RTG and PCT hidden. The scoring summary is grouped by quarter.
  - **Auto-refresh:** every 30 s while the game is live, paused while the tab is hidden. A failed auto-refresh keeps the data on screen.
- **`.live-dot`** moved to `styles.css`, shared by the matchup cells, the strip and the game page.

## Verification done

- **Builds:**
  - `dotnet build`: 0 warnings, 0 errors.
  - `ng build` passes. The initial bundle is 1.56 MB, 59 kB over the warning budget (it was 41 kB over), because the strip and its utils load with the matchup view.
  - Vitest: 125 tests.
- **`POST /api/espn/nfl-game` against ESPN:**
  - Final game 401872991: the score, linescores, record, broadcast, last play, 10 scoring plays, all 11 team stats and all four box score categories for both teams match ESPN's game page.
  - Pregame game 401872994: kickoff and broadcast, with no plays, stats or box score.
  - An unknown id answers 404, and a non-numeric id 400.
  - With a league id that doesn't exist, `fantasyPlayers` is null and the rest of the game loads.
- **UI against a mock API.** It served real ESPN week-5 data, mapped as the backend does, with DET @ ARI made live in the red zone.
  - The strip opened centred on the live game, showing the red-zone tint, Final / Final/OT cards, the bye entry and counts per side.
  - The live game page rendered every section, and the numbers matched ESPN's box score.
  - The pregame page (BUF @ LAR) showed kickoff, broadcast and "players to watch" sorted by projection.
  - `?team=2` carried through the strip links and Back. An unknown id showed the error with Retry.
  - Auto-refresh paused while the page was hidden. On becoming visible, the overdue refresh fired at once, and the next came 31 s later.
- **On the real league (week 5):**
  - The strip showed all 15 games, the bye teams (CAR, KC) and both sides' counts, with no images loaded.
  - On SF @ SEA, the fantasy points were the league's own (`appliedTotal`). George Kittle, starting for the user's team, got the green dot in both the fantasy list (12th) and the box score.
  - The Back button read "Back to NRNP vs BSTB" and returned to `/matchup`.
  - No horizontal overflow at 375px on the matchup view or the game page.
- **Still to do:**
  - The live spike above, then a real live window: check that the last play, clock and possession move on the strip and the game page.
  - Spot-check two or three players' fantasy points against ESPN's own matchup page.

## Development environment (2026-10-12)

- The .NET 8 SDK (8.0.425) was installed with winget on the dev machine.
- A stray Yarn PnP manifest in the home folder (`C:\Users\brboy\.pnp.cjs`, June 2024) made esbuild ignore `node_modules`. It was moved to the Recycle Bin.
- `.claude/launch.json` defines `frontend` (`ng serve`, port 4200) and `backend` (`dotnet run --launch-profile http` from `backend/`, port 8080) for preview servers. It's gitignored as local tooling.
- The backend needs `ConnectionStrings:FantasyX` in user-secrets to start.

---

# Roster suggestions (issue #25)

Advice that improves your team, in three parts, each a sub-issue with its own branch, PR and section here: the start/sit assistant (#26, v1.12), the waiver wire assistant (#27) and the trade analyzer (#28). Waivers and trades are blocked by start/sit, which builds the base the other two reuse.

Shared decisions (2026-10-14):

- **Home:** a new **Advice** tab (`/advice`), with one sub-tab per tool. Each tool fills in its tab when it ships.
- **Lineup optimizer:** the best legal lineup a roster can field under the league's `LineupSlots`, solved exactly (see v1.12). Start/sit uses it on this week's projections. Waivers and trades use it inside roster value.
- **Roster value** (rest of season): the sum, over every NFL week from this one through the last week of the fantasy playoffs, of the best lineup the roster (IR aside) can field that week. Byes, depth and positional need all count, so a fourth QB adds almost nothing. It's the same method and window as v1.8's per-week strength and v1.9's ROS. A change (a pickup, a drop, a trade) is valued as the roster's value after it minus before.
- **Projections** follow the ESPN / FantasyX setting everywhere, with the "FantasyX projections" tag, as in v1.7.

---

# v1.12: Start/sit assistant (issue #26) — on `26-add-start-sit-assistant`

## Goal

Tell you who to start this week. Compare your set lineup with the best one your roster can field, list the changes that would gain points, show how close each call is, and show what the changes do to your chance of winning the matchup. It also builds the lineup optimizer and roster value that #27 and #28 reuse.

## Decisions (asked 2026-10-14)

- **Placement:** a new **Advice** tab after Players in the header nav (`pi pi-lightbulb`, icon-only on phones like the others).
  - `/advice` redirects to `/advice/start-sit`. A `p-tabs` row shows **Start/Sit**, **Waivers** and **Trades**. The last two are disabled, marked "Soon", until #27 and #28 fill them.
  - The route is lazy-loaded, like `/players`, to keep it out of the initial bundle (already 59 kB over the warning budget).
  - **Your team only.** There's no `?team=` and no advice for other teams' rosters.
  - **Roster hint:** your own roster view gets a one-line banner above Starters when there are suggested changes ("2 lineup changes suggested · +6.4 pts"), linking to `/advice/start-sit`. It's hidden when the lineup is already the best, while anything is loading, and on other teams' rosters.
- **Objective: projected points.** The optimizer maximises the starters' projected total under the active source. It doesn't chase variance. Win probability is shown beside it, not optimised.
- **Win probability, before → after:** the existing `winProbability` (v1.6), run on the set lineup and again on the suggested one, against this week's opponent ("Win chance 48% → 54%"). It's hidden on a bye week (no opponent), and when the matchup period spans more than one NFL week, as the matchup view's projections cover this week only.
- **Close calls: chance to outscore.** Each change pairs a player in with a player out and shows the chance the one in outscores the one out:
  - `P = Φ((μ_in − μ_out) / √(σ_in² + σ_out²))`, with `μ` the active projection and `σ` each player's `playerSpread` (v1.6: their misses against the active source, shrunk toward the position default).
  - Under `TOSS_UP_PERCENT` (55) the change is labelled a **toss-up**. It's still suggested, since it still gains points.
  - Filling an empty slot shows no chance.
- **This week only:** advice is for the current scoring period, on this week's projections. Setting future weeks' lineups is out of scope.
- **Locks:** a player is locked once their game kicks off (`gameTimeUtc` passed, or `gameState` in or post), as on ESPN. Locked starters stay where they are, and locked bench players can't come in. The page re-checks locks every minute against the clock, so a player locks at kickoff without a refetch. With everything locked, the page says there's nothing left to change.
- **Who can start:** every rostered player not on IR and not locked. A player's eligibility is their position against each slot's `eligiblePositions`. Starters in slots the league's `LineupSlots` don't cover (IDP) are left exactly as they are.
- **Ties keep your lineup.** A player already in a slot gets a tiny bonus (`KEEP_EPSILON`) there, so the optimizer never suggests a change that gains nothing.
- **Warnings** (shown even when nothing better is available): a starter on bye, or projected at 0 (ruled out), with no eligible bench player to replace them. These name the slot, as a pointer toward waivers (#27).
- **Context per player:** the lineup list shows each player's weekly position rank ("WR14 this week") from v1.9's This Week rankings (`PlayerRankingsService.rankingsFor('week')`). If those rankings fail, the column is left out and nothing else changes.
- **Not done:** making lineup changes on ESPN (the app stays read-only), late-game hedging (starting a Monday player to keep options open), and risk-aware or ceiling/floor lineups.

## Backend

- **Slot names:** `EspnLookups.SlotName` gains the slots it doesn't name today, which show as `SLOT_n` on the roster: 1 `TQB`, 3 `RB/WR`, 5 `WR/TE`, 7 `OP`. Names come from the same table as `StartingSlot`, so a player's `Slot` always matches a `LineupSlot.Slot`. The frontend needs this to tell which slot each starter is in.
- Nothing else. The week of matchups already carries every roster, lineup slot, projection, game time and game state, and the league carries `LineupSlots`.

## Frontend

- **`utils/lineup.ts`** (new, pure, the shared base):
  - `LineupPlayer { playerId, position, projected, slot: string | null, locked: boolean }`.
  - `optimalLineup(players, slots)`: the exact best assignment.
    - Expand the slots into one entry per starter (`slotFillOrder`).
    - Seat locked starters in their own slot entries.
    - Solve the rest as a maximum-weight assignment (Hungarian / Kuhn–Munkres) of unlocked players to open slot entries. The weight is the projection when the position is eligible, plus `KEEP_EPSILON` for a player's current slot. Ineligible pairs are excluded.
    - Returns each slot entry's player (or none), the bench, and the total.
    - Exact because greedy-by-restrictiveness is only optimal when slots nest. It fails with `RB/WR` plus `WR/TE` slots, for example. A roster is under 20 players by about 10 slots, so the cost is negligible.
  - `bestLineupTotal` moves here, as `optimalLineup(...).total` with no locks or current slots. `power-rankings.ts` re-exports it, so its callers don't change. Draft-day and per-week strengths get the exact answer too.
  - `rosterValue(players, slots, weeks, projectionFor)`: the best lineup total for each week (IR left out) and their sum. `LeagueOutlookService.weeklyStrengths` uses it for weeks after this one, replacing its inline loop, so it's exercised from this PR on. Waivers and trades use it next.
- **`utils/start-sit.ts`** (new, pure). Every tunable constant lives here.
  - `isLocked(player, now)`
  - `lineupChanges(current, optimal)`: players moving in and out, paired at the same position where possible, else by eligibility. An in-player with no partner fills an empty slot. Moves between starting slots aren't changes; they show in the lineup list.
  - `chanceToOutscore(a, b)`, using `playerSpread` and `normalCdf` from `win-probability.ts`.
  - `startSitAdvice(input)`: the current and best totals, the gain, the paired changes with their chance and toss-up flag, warnings, and each player's verdict: Start, Sit, Locked, Bye, Out or IR.
- **`StartSitService`** (root): combines your team and opponent from `WeekMatchupsService`, `LineupSlots` from `LeagueOutlookService`, and `projectionOf` / `residualsOf` / status from `ProjectionsService`. It exposes `advice`, `status` and `refresh()`. Win chance before and after comes from `winProbability`, with your side's starter flags taken from the suggested lineup. The Advice page force-loads the week on each visit and on Refresh, since you may have just changed your lineup on ESPN. The roster hint reads the cached week.
- **Components:**
  - `AdviceComponent`: the lazy `/advice` shell, with the tab row and a child `router-outlet`.
  - `StartSitComponent`, with three parts:
    - A summary card: the gain, win chance before → after, and the projection-source tag.
    - The suggested changes, each reading "Start A over B", with both players' avatars, slots, projections, the gain and the chance (or a toss-up tag), plus any warnings.
    - The lineup slot by slot, suggested next to current, with verdict tags and weekly position ranks. Rows open the existing player drawer.
  - A Refresh button, as on the matchup view. On phones, changes stack as cards, and the lineup list drops its rank column.
  - The nav tab, and the roster hint in `TeamDisplayComponent`.
- **Failure:**
  - The week fails: the error and Retry, as on the matchup view.
  - The league (slots) fails: the advice is unavailable, with Retry.
  - FantasyX projections loading: skeletons. Unavailable: ESPN figures with the existing "FantasyX projections unavailable" note, never ESPN numbers under a FantasyX label.
  - Residuals missing: position-default spreads, so chances still show.
  - Weekly rankings fail: no rank column.

## Verification

1. **Vitest:**
   - `optimalLineup`:
     - It matches the greedy fill on a standard lineup.
     - It beats greedy on an `RB/WR` + `WR/TE` counterexample.
     - It fills `OP` in superflex.
     - Locked starters stay put, and locked bench players never come in.
     - IR is never started. Empty slots are filled when someone can play them.
     - Ties keep the current lineup.
   - `rosterValue`: it sums each week's best lineup, and a bye week drops that player for that week only.
   - `lineupChanges`: one-for-one swaps pair at the same position, a chain (bench RB → RB, RB → FLEX) pairs sensibly, and an empty-slot fill has no partner.
   - `chanceToOutscore`: 50% for identical players, symmetric, and rising with the projection gap.
   - Toss-up threshold, verdicts, and warnings for a starter on bye with no backup.
   - The existing power-rankings and player-rankings tests still pass.
2. **Backend:** `dotnet build`. Check that a superflex (`OP`) or `RB/WR` league's roster shows proper slot names instead of `SLOT_n`.
3. **UI against a mock API:** cover these cases:
   - a bench player out-projecting a starter
   - a starter on bye with a bench backup, and one without
   - an Out starter
   - a game in progress (locked players on both sides)
   - an empty FLEX
   - a multi-week playoff period (no win chance)
   - a bye week (no opponent)

   Then check:
   - The roster hint appears and disappears with the lineup, and only on your team.
   - Locks flip at kickoff without a refetch.
   - Switching to FantasyX re-runs the advice, and the tag follows.
   - The Waivers and Trades tabs are disabled.
   - At 375px, all five nav tabs fit with no page overflow (narrow the icon tabs again if not).
4. **Live league:**
   - Before Sunday's games, the suggestions should agree with the gaps in ESPN's own projections in ESPN mode, and the win chance after should match the matchup view once the changes are made on ESPN and the page is refreshed.
   - Power rankings and playoff odds should be unchanged on this league's standard lineup, since exact and greedy agree there.

## As built

- **Shared base:**
  - `utils/lineup.ts` holds `slotFillOrder`, `optimalLineup`, `bestLineupTotal` and `rosterValue`. `power-rankings.ts` re-exports the first two and `LineupCandidate`.
  - A player projected at 0 or below only starts if they're already in that slot. So a bye isn't swapped for another bye, and a starter on bye with no backup stays put and gets a warning.
- **Start/sit logic:**
  - `utils/start-sit.ts` also has `currentLineup`, the set lineup in the optimizer's shape.
  - Verdicts check in this order: IR, Locked, Bye, Out, then Start or Sit. A starter in a slot the settings don't cover (IDP) reads Start.
  - Warnings skip locked players.
- **Service:** `StartSitService` runs a one-minute clock for locks once anything asks for advice. Its `retry()` refetches the league when the lineup settings failed, and the week either way.
- **Page:**
  - Each change reads "Start A over B", with "over" in the second player's verb column so the names line up when they stack on phones. A player benched with no one coming in reads "Bench B".
  - The lineup list shows the suggested starters, then the bench and IR. Players moving in or out get a primary-coloured edge on their row.
  - The Advice sub-tab row is scrollable. On phones the "Soon" tags are dropped, and the header's icon tabs narrow to 0.625rem padding so all five fit.
- **Fixed on the way:** `LeagueOutlookService.refresh()` never refetched. Its request signal returned the same object, so the reload count was read but nothing downstream saw a change. The League page's Retry and its refetch on every visit were both affected. The request now carries the reload count.

## Verification done

- **Builds:**
  - `dotnet build`: 0 warnings, 0 errors.
  - `ng build` passes. The initial bundle is 1.57 MB, 70 kB over the warning budget (it was 59 kB over), because the roster hint brings the start/sit logic into it. `/advice` is a separate 17.5 kB chunk.
  - Vitest: 154 tests, 29 of them new (12 in `lineup.spec.ts`, 17 in `start-sit.spec.ts`). The existing power-rankings and player-rankings tests pass unchanged.
- **UI against a mock API** (the production build served with a hand-built week 7 roster):
  - **Main case:** 3 changes for +15.6 pts.
    - A bench RB replaces a weaker RB, 67% to outscore.
    - A bench WR replaces an RB in FLEX, paired by slot.
    - A bench TE replaces a starter on bye.
    - An Out kicker with no backup gets a warning.
    - A live WR starter and a live WR on the bench (projected 20) both read Locked and are never moved.
    - Win chance goes from 17.2% to 35.5%.
  - **Roster hint:** shows "3 lineup changes suggested · +15.6 pts" on your team only. It's gone once the lineup is the best.
  - **Edge cases:**
    - A bye week and a multi-week round hide the win chance.
    - A failed week shows the error with Retry.
    - A failed league shows "unavailable" with Retry, and Retry recovers.
    - The League page's Retry now recovers too.
    - FantasyX mode shows the tag.
  - **Phone width:** no page overflow at 375px on the Advice page or the roster page.
- **Live league (2026-10-14):** checked and verified by the user on their real league, covering step 4. This also showed the advice with real weekly position ranks and headshots, which the mock couldn't.
- **Not checked yet:**
  - A lock flipping at kickoff while the page is open. Only the unit tests cover it.
  - Step 2's check that an `OP` or `RB/WR` league shows real slot names. That needs a league with those slots.

## Open questions

- Whether a weekly position rank is worth its cost: it loads the available players on every Advice visit (cached per session).
- Whether the toss-up threshold (55%) feels right once seen on real lineups.
- Risk-aware lineups for heavy underdogs or favourites. They're deferred, and could come back as a "Play to win" switch using the same spreads.

---

# v1.13: Waiver wire assistant (issue #27) — on `27-add-waiver-wire-assistant`

## Goal

Tell you which free agents and waiver players are worth claiming, and who to drop for them. A pickup is judged by how much it raises your roster value (the best lineup you can field each week, summed over the rest of the season), so "better than your starter" counts, not raw rank. Builds on v1.12's lineup optimizer and `rosterValue`, and on v1.9's available-player pool.

## Decisions (asked 2026-10-15)

- **Placement:** the **Waivers** sub-tab of Advice (`/advice/waivers`), enabled now. It's in the lazy `/advice` chunk.
  - **Your team only**, as with start/sit.
  - **No hints elsewhere.** The roster page doesn't load the available players, and start/sit's warnings stay as they are.
- **Ranking: rest-of-season gain, with this week's beside it.** Each pickup is ranked by its roster value gain: `rosterValue` after the add and drop, minus before, over the shared window (this week through the last week of the fantasy playoffs). This week's best-lineup gain is shown next to it ("+18.4 ROS · +3.1 this week"), but doesn't rank.
- **Drop: the best one per pickup.** For each pickup, every droppable player is tried, and the drop that leaves the highest roster value wins. The next-best drop is shown as the alternative ("or drop Z, +15.2").
  - With an open roster spot, no drop is needed. "No drop" is simply one of the options, so it wins whenever dropping anyone would cost value.
  - **Not droppable:** players on IR (the IR slot doesn't free a bench spot, and roster value leaves them out, so they'd look free), players at positions no starting slot takes (IDP, which roster value can't see), and locked players.
- **Waiver info: status, priority and FAAB left.**
  - Each player is tagged **Free agent** or **Waivers** (already on `AvailablePlayer.status`).
  - The summary shows your waiver priority ("3rd of 12") or, in a FAAB league, your budget left ("$64 of $100").
  - No bid suggestions.
- **Who gets evaluated: a safe prefilter, then everyone left, on the main thread.**
  - The pool is the available players v1.9 already loads (`AVAILABLE_PER_POSITION`, 50 per starting position), with their weekly projections from the rest-of-season rankings.
  - **Prefilter:** a player is evaluated only if, in some week of the window, they out-project the weakest starter in that week's best lineup, or that lineup has an empty slot. A pickup can only raise a week's best lineup by bumping its weakest starter to the bench (through a chain of moves if need be) or by filling an empty slot, and a drop only lowers it. So anyone the prefilter skips has no positive gain with any drop. Comparing with eligible starters only would not be safe: with `RB/WR` and `WR/TE` slots, an RB can gain by pushing a WR into `WR/TE`.
  - The rest (typically a few dozen) are evaluated against every drop, inline. The build measures it on the live league, and moves it to a web worker, like playoff odds, only if it's slow.
- **The list: positive gains only, with position chips.**
  - Pickups whose best add/drop gains at least `MIN_GAIN` (0.5 pts), up to `MAX_SUGGESTIONS` (25), best first.
  - Chips: **All** and each of the league's starting positions (`startingPositions`). A chip filters the pickups by position, still up to 25.
  - Empty state: "Nobody available beats your roster" (or "…at WR" under a chip).
- **Locks:** start/sit's `isLocked`.
  - A locked free agent (their game has kicked off) can still be suggested. Their this-week projection counts as 0, so their gain comes from next week on.
  - A locked rostered player isn't offered as a drop.
  - Locks are re-checked every minute against the clock, as on start/sit.
- **Projections** follow the ESPN / FantasyX setting, with the "FantasyX projections" tag (v1.7).
- **Not done:** making claims on ESPN (the app stays read-only), FAAB bid suggestions, two-for-one moves (add two, drop two), and when a waiver claim clears (the this-week gain assumes it clears before the player's game).

## Spike (2026-10-15)

- **League settings** (`mSettings`, on `leaguedefaults/3`, then on the real league):
  - `settings.acquisitionSettings` has `isUsingAcquisitionBudget` and `acquisitionBudget`, plus `acquisitionType` ("WAIVERS_TRADITIONAL"), `waiverHours`, `waiverProcessDays` and `minimumBid`.
  - `acquisitionBudget` is 100 even when `isUsingAcquisitionBudget` is false. The budget only means anything with the flag on.
  - `rosterSettings.lineupSlotCounts` covers bench (20) and IR (21) too. Every slot but IR sums to the roster size: 16 on the defaults (9 starters, 7 bench).
- **Teams** (`mTeam`, real league only, since `leaguedefaults` has none):
  - `waiverRank` is there on every team, 1 to 14 with no repeats.
  - `transactionCounter.acquisitionBudgetSpent` is there too. It's 0 on every team in this non-FAAB league.
- **The real league:** a roster size of 14 (9 starters, 5 bench). The user's team has 14 players off IR and 1 on it, so it's full and IR doesn't count. Waiver priority 9th of 14. Not FAAB.
- **How it was read:** from the app's own tab, through a backend built from this branch on port 8081, so the league's cookies never left the page.
- **Still to see:** a FAAB league, with a real budget spent.

## Backend

- **`LeagueDto`** (`POST /api/espn/league`, already fetched with `mTeam` and `mSettings`) gains:
  - `RosterSize`: the sum of `rosterSettings.lineupSlotCounts` over every slot but IR (21), bench and IDP included. You have an open spot when your players off IR number fewer than this.
  - `Acquisition`: `{ UsesBudget, Budget }`, from `settings.acquisitionSettings` (`isUsingAcquisitionBudget`, `acquisitionBudget`). Null when ESPN doesn't send it.
- **`StandingDto`** gains `WaiverRank` (the team's `waiverRank`) and `BudgetSpent` (`transactionCounter.acquisitionBudgetSpent`), both nullable.
- **Spike first:** confirm those four ESPN field names on the live league's raw response before modelling them, the way v1.11 checked the scoreboard. Done; see Spike above.
- Nothing else. `POST /api/espn/available-players` already returns each player's status, weekly history and upcoming projections.

## Frontend

- **Models:** `League` gains `rosterSize` and `acquisition: { usesBudget: boolean; budget: number } | null`. `Standing` gains `waiverRank` and `budgetSpent` (`number | null`).
- **`utils/waivers.ts`** (new, pure). Every tunable constant lives here.
  - `WaiverCandidate { playerId, position, projections: Record<number, number> }`, the shape `rosterValue` reads, with each week's projection.
  - `weakestStarters(roster, slots, weeks, projectionFor)`: for each week, the lowest projection in the roster's best lineup, or 0 when a slot is left empty. Built with `optimalLineup` once per week.
  - `mightHelp(candidate, weakest)`: the prefilter above.
  - `droppable(player, now)`: not IR, at a starting position, and not locked.
  - `bestMoves(roster, candidate, input)`: for each option (no drop when there's room, then each droppable player), the roster value after it. Returns the best and next-best, with the ROS gain, this week's gain (`byWeek` of this week, after minus before), and how many weeks of the window the pickup starts in.
  - `waiverAdvice(input)`: the before value, the prefiltered candidates, their best moves, cut to `MIN_GAIN` and sorted by ROS gain, then this week's gain, then player id. Also returns how many were evaluated and skipped, for the timing check.
  - A locked candidate's projection for this week is 0. Projections for everyone, rostered or available, come from the rest-of-season rankings' `weeklyProjections` (the active source over the same window).
- **`WaiversService`** (root, only injected by the lazy page so it stays out of the initial bundle):
  - Combines your roster from `WeekMatchupsService` (as start/sit picks it), `lineupSlots`, `rosterSize`, `acquisition` and your standing from `LeagueOutlookService`, and the rest-of-season `PlayerRankingsService.rankings()` for the pool and projections.
  - Exposes `advice`, `status` (`loading`, `error`, `unavailable`, `over`, `ready`), `retry()` and `refresh()`.
  - **Freshness:** the page force-loads the week on each visit (you may have just made a move on ESPN), like start/sit. The available players stay cached for the session. Refresh refetches them too, through a new `force` flag on `AvailablePlayersService.load` and a `refresh()` on `PlayerRankingsService`, since other managers' claims change who's available.
  - A rostered player missing from the rankings (added since they loaded, and outside the top 50 available) is valued with `ProjectionsService.futureProjectionOf`. The build checks that a just-added player isn't valued at 0.
- **`WaiversComponent`** (`/advice/waivers`):
  - **A summary card:** your waiver priority or FAAB left, whether you have an open roster spot, and the projection-source tag.
  - **Position chips.**
  - **The pickups,** each reading "Add A, drop B":
    - Both players' avatars, positions and teams, and the pickup's Free agent / Waivers tag and injury status.
    - The ROS gain, this week's gain, and "Starts 8 of 11 weeks".
    - The pickup's v1.9 position rank ("WR28 ROS") for context.
    - The next-best drop beneath, when there is one.
    - Rows open the existing player drawer.
  - A Refresh button. On phones the pickups stack as cards.
  - `advice.routes.ts` gets the route, and `AdviceComponent` marks Waivers ready.
- **Failure:**
  - The week fails: the error and Retry, as on start/sit.
  - The league or rankings are unavailable: "Waiver advice unavailable", with Retry.
  - The available players failed (`rosteredOnly`): "Couldn't load the available players", with Retry. Never an empty list that reads as "nobody beats your roster".
  - The fantasy playoffs are over (`over`): "The season's over."
  - No waiver rank or acquisition settings: the summary leaves that line out.
  - FantasyX projections loading or unavailable: as on start/sit.

## Verification

1. **Vitest** (`waivers.spec.ts`):
   - The gain equals `rosterValue` after minus before.
   - The prefilter never skips a player with a positive gain, including the `RB/WR` + `WR/TE` case, and skips a player who beats no starter in any week.
   - With an open spot there's no drop, and a full roster drops someone.
   - The best drop is chosen across positions: dropping a backup RB beats dropping a starting WR, and a fourth QB goes before anyone else.
   - IR players, IDP players and locked players are never dropped. IR players don't count toward the open-spot check.
   - A locked free agent gains nothing this week but keeps their later weeks.
   - `MIN_GAIN`, `MAX_SUGGESTIONS`, the sort order, and the position filter.
   - The existing lineup, start/sit and player-rankings tests still pass.
2. **Backend:** `dotnet build`, and the spike's field names. Check `RosterSize`, `WaiverRank`, `BudgetSpent` and `Acquisition` against what ESPN's own league page shows, on a FAAB league if one is available.
3. **UI against a mock API:** cover these cases:
   - a full roster, with a clear upgrade at one position and a weak player at another
   - an open roster spot
   - a free agent whose game is in progress
   - a waiver player
   - a FAAB league and a waiver-priority league
   - nobody worth adding
   - the available players failing
   - the playoffs over

   Then check:
   - The chips filter and the empty state.
   - Switching to FantasyX re-runs the advice, and the tag follows.
   - Refresh refetches the available players.
   - No page overflow at 375px.
   - The initial bundle doesn't grow.
4. **Live league:**
   - Time `waiverAdvice` and note how many players the prefilter kept. Move it to a worker if it takes over about 100 ms.
   - Spot-check one suggestion by hand: the pickup's weekly projections against your weakest starter's, and the drop against the Players page.
   - The waiver priority or FAAB figure matches ESPN.

## As built

- **Backend:**
  - `EspnLookups.TakesRosterSpot` (every slot but IR) is behind `RosterSize`.
  - ESPN's budget fields are read as doubles and rounded to whole dollars, so a budget sent as `100.0` can't break the league call.
- **`utils/waivers.ts`:**
  - `WaiverPlayer` (`playerId`, `position`, `projections` by week), with `RosterEntry` (`injuredReserve`, `droppable`) and `AvailableEntry` (`locked`) built on it.
  - `droppable(player, startingPositions, locked)` takes the lock as a flag. `proTeamLocked(proTeam, nflGames, now)` locks a free agent, since available players carry no kickoff time. It reads the week's NFL games, and locks nobody when the scoreboard couldn't be read.
  - `weakestStarters` and `mightHelp` are the prefilter. `forPosition` applies the chip and `MAX_SUGGESTIONS`.
  - A player already on the roster is never a pickup, since ESPN's free-agent list can lag a move.
- **The drop search** (changed after the first build, which took about 450 ms on the live league): rather than trying every drop for 12 weeks, it uses three facts about best-lineup values:
  - **Ceiling:** no pickup gains more than it would with an open spot. A pickup whose ceiling is under `MIN_GAIN` stops there.
  - **Projection bound:** a pickup gains at most its own projected points minus what the drop costs the roster today.
  - **Unaffected weeks:** dropping a player who isn't in a week's best lineup (with the pickup added) changes nothing that week, so only the weeks they start in are solved again.

  Drops are tried cheapest first, and the search stops once neither bound lets a later drop beat the top two. That's 18–27 ms on the live league, with the same results, so there's no worker.
- **Ties between drops** go to the one that costs the roster less today, then to whoever is projected for fewer points. On the live league, both an injured WR (0 projected) and a backup QB cost nothing, and the WR is dropped first.
- **`WaiversService`:**
  - Reuses `StartSitService`'s week, which the page force-loads on each visit, its one-minute lock clock (now exposed as `now`) and the week's `nflGames`.
  - The locked sets are computed once per tick and compare equal when nothing flipped, so the advice only reruns when a lock changes, not every minute.
  - The pool is the rest-of-season rankings' non-rostered players, and everyone's projections are their `weeklyProjections`.
  - `PlayerRankingsService.refresh()` and `AvailablePlayersService.load(…, force)` refetch the available players. A refresh keeps the players on screen until the new ones arrive (`refreshing`).
- **Page:**
  - The summary reads "N pickups would improve your roster", then waiver priority or FAAB left, roster full or open spots, and the window's weeks.
  - Each card reads "Add A / Drop B" (or "No drop needed"), with the ROS gain, this week's gain ("Nothing this week" when it rounds to 0) and "Starts N of M weeks". The alternative drop sits underneath.
  - Pickups are tagged Waivers or Free agent, with their status and a Locked tag. Every player opens the drawer.
  - The Refresh button reads "Refresh Players".

## Verification done

- **Builds:**
  - `dotnet build`: 0 warnings, 0 errors.
  - `ng build` passes. The initial bundle is unchanged (1.57 MB, 70 kB over the warning budget, as on `main`). The `/advice` chunk grows from 17.5 kB to 36.2 kB.
  - Vitest: 173 tests, 19 of them new in `waivers.spec.ts`. Two compare against brute force on random rosters: the prefilter never skips a pickup that would gain (200 rosters with an open spot), and the bounded drop search finds the same best and next-best gains as trying every drop (150 full rosters).
- **On the live league (week 6), with a backend built from this branch:**
  - 260 available players. The prefilter kept 150, and 105 gain at least 0.5 pts over weeks 6–17.
  - The top pickups are D/STs, each dropping an injured WR projected at 0 (or the backup QB, for the same gain). The WRs and kickers further down are bye-week fill-ins ("Starts 1 of 12 weeks").
  - Waiver priority 9th of 14, roster full.
  - Position chips filter the list, the drawer opens from any player, and Refresh refetches the week and available players while keeping the cards.
  - FantasyX mode reruns the advice with the tag shown (the top D/ST goes from +30.7 to +34.9).
  - No page overflow at 375px.
- **Edge cases, by rewriting the app's own API responses in the page:**
  - A FAAB league with $37 spent and one open roster spot: "FAAB $63 of $100 left", "1 open roster spot", and every card reads "No drop needed" with no alternative.
  - The available players failing on Refresh: "Couldn't load the league's available players" with Retry, never an empty list, and Retry recovers.
  - The clock a week ahead: 21 of 25 pickups locked (the rest on bye), each losing its this-week gain and a week of starts.
- **Dev setup note:** the backend's Data Protection keys are tied to its content-root path (`AddDataProtection()` with no application name). A backend run from a worktree can't read credentials saved by the main checkout, and answers 500 on `GET /api/credentials`. Running it with `--contentRoot` set to the main checkout's `backend\` folder works around it.
- **Not checked yet:**
  - A real FAAB league.
  - A pickup's lock flipping at kickoff while the page is open (only the clock jump above, and the unit tests).
  - The week failing (shared with start/sit, which was checked in v1.12).
  - The season being over. Only the rankings' `over` status covers it.

## Open questions

- Whether `MIN_GAIN` (0.5 pts) is the right cut-off. On the live league, 105 pickups clear it, many of them bye-week fill-ins for a player worth nothing. A higher cut-off, or ranking those last, may read better.
- Whether roster value's indifference to depth suggests dropping handcuffs and injured starters too eagerly. A player out for weeks still counts for the weeks after their return, but a backup is worth nothing until a starter's bye.
- Whether claims that clear mid-week need their this-week gain hidden or discounted.
- The rankings' rostered players come from the week loaded when the session started. A player another team dropped since then only shows up as available after a page reload, even after Refresh.
