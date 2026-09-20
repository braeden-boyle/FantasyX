# FantasyX
Custom fantasy football dashboard; import your team, get insights, news, and more.

## Status

v1 scope: import a team from ESPN (public or private league) and display its roster. Optional per-device credential persistence (see below); no accounts, no insights yet

## Structure

- `backend/` — ASP.NET Core Web API (.NET 8, C#) that proxies and maps ESPN's fantasy API.
- `frontend/` — Angular SPA (PrimeNG + Tailwind CSS) with an import form and roster display.

## Running locally

**Backend** (from `backend/`):

```bash
dotnet run
```

Runs on `http://localhost:8080` (`https://localhost:8443` also available).

**Frontend** (from `frontend/`):

```bash
npm install
npm start
```

Runs on `http://localhost:4200` and expects the backend at `http://localhost:8080` (see `src/environments/environment.ts`).

### Private ESPN leagues

Public leagues only need a league ID and season. Private leagues additionally require the `espn_s2` and `SWID` cookies from an authenticated ESPN browser session (Devtools → Application/Storage → Cookies → `fantasy.espn.com`).

By default these are only sent per-request and never stored. Checking **"Remember these details on this device"** saves them server-side (Postgres, hosted on Supabase), encrypted at rest via ASP.NET Core's Data Protection API, keyed by an opaque device ID stored in the browser's `localStorage` — there are no user accounts or passwords. "Forget saved details" deletes that row. Because there's no login, the device ID itself is effectively a bearer credential for that saved data; this is an accepted tradeoff for a single-user personal app, not something to expose to other people.

**Local setup**: requires a Postgres connection string set via .NET's Secret Manager (never commit it to `appsettings.json`):

```bash
cd backend
dotnet user-secrets set "ConnectionStrings:FantasyX" "<your Supabase session-pooler connection string>"
dotnet ef database update
```
