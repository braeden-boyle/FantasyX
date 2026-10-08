# FantasyX — Plan

## Status (as of 2026-10-07)

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
