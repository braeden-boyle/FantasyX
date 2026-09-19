# FantasyX
Custom fantasy football dashboard; import your team, get insights, news, and more.

## Status

v1 scope: import a team from ESPN (public or private league) and display its roster. No persistence, no insights yet — see [the plan](.) for details.

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

Public leagues only need a league ID and season. Private leagues additionally require the `espn_s2` and `SWID` cookies from an authenticated ESPN browser session (Devtools → Application/Storage → Cookies → `fantasy.espn.com`). These are sent per-request to the backend and are never persisted or logged.
