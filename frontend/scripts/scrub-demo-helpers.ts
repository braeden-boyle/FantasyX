import { League, TeamSummary } from '../src/app/models/team.model';
import { DEMO_LEAGUE_NAME, DEMO_OWNERS, DEMO_TEAMS, FALLBACK_OWNER } from './demo-names';

// The demo scrub's pure parts, kept apart from it so Vitest can import them without touching files.
// The scrub swaps the league's identity for made-up names, then refuses to write anything if a
// trace of the real league is left. See docs/PLAN.md, "Demo mode".

// The real league's names and what each becomes.
export interface Identity {
  teams: Map<number, { name: string; abbrev: string }>;
  owners: Map<string, string>;
  // Everything real, for the leak check: team names, abbreviations, owners and league names.
  originals: { teamNames: string[]; abbrevs: string[]; owners: string[]; leagueNames: string[] };
}

// Fantasy teams come in from both scenarios' teams list and standings; the same team gets the same
// made-up name wherever it's met.
export function buildIdentity(sources: { teams: readonly TeamSummary[]; league: League }[]): Identity {
  const realTeams = new Map<number, { name: string; abbrev: string }>();
  const realOwners: string[] = [];
  const leagueNames = new Set<string>();
  for (const { teams, league } of sources) {
    leagueNames.add(league.leagueName);
    for (const team of [...teams, ...league.standings]) {
      if (!realTeams.has(team.teamId)) realTeams.set(team.teamId, { name: team.name, abbrev: team.abbrev });
    }
    for (const standing of [...league.standings].sort((a, b) => a.teamId - b.teamId)) {
      for (const owner of standing.owners) if (!realOwners.includes(owner)) realOwners.push(owner);
    }
  }

  const teamIds = [...realTeams.keys()].sort((a, b) => a - b);
  if (teamIds.length > DEMO_TEAMS.length) {
    throw new Error(`The league has ${teamIds.length} teams, more than the ${DEMO_TEAMS.length} demo names.`);
  }
  return {
    teams: new Map(teamIds.map((id, i) => [id, DEMO_TEAMS[i]])),
    owners: new Map(realOwners.map((owner, i) => [owner, DEMO_OWNERS[i] ?? FALLBACK_OWNER])),
    originals: {
      teamNames: teamIds.map((id) => realTeams.get(id)!.name),
      abbrevs: teamIds.map((id) => realTeams.get(id)!.abbrev),
      owners: realOwners,
      leagueNames: [...leagueNames],
    },
  };
}

// ESPN's preset team logos, which show nothing about the league. Anything else (an uploaded logo,
// or a link to an image anywhere on the web) is dropped for the fallback mark.
export function isPresetLogo(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'g.espncdn.com' || hostname === 'a.espncdn.com');
  } catch {
    return false;
  }
}

// A fantasy team, wherever it turns up: a team, a standing, a teams-list entry. NFL teams carry
// proTeamId instead, so they're left alone.
function isFantasyTeam(value: Record<string, unknown>): boolean {
  return typeof value['teamId'] === 'number' && typeof value['name'] === 'string';
}

// A copy of value with the league's identity swapped out, at any depth.
export function scrubValue(value: unknown, identity: Identity): unknown {
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, identity));
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(source)) {
    result[key] = scrubValue(field, identity);
  }
  if (isFantasyTeam(source)) {
    const demo = identity.teams.get(source['teamId'] as number);
    if (!demo) throw new Error(`Team ${source['teamId']} isn't in the league's standings.`);
    result['name'] = demo.name;
    if ('abbrev' in source) result['abbrev'] = demo.abbrev;
  }
  if (Array.isArray(source['owners'])) {
    result['owners'] = (source['owners'] as string[]).map((owner) => identity.owners.get(owner) ?? FALLBACK_OWNER);
  }
  if (typeof source['leagueName'] === 'string') result['leagueName'] = DEMO_LEAGUE_NAME;
  if (typeof source['logoUrl'] === 'string' && !isPresetLogo(source['logoUrl'])) result['logoUrl'] = null;
  return result;
}

export interface Leak {
  path: string;
  what: string;
}

// ESPN's cookies: the SWID is a braced GUID, and espn_s2 a long URL-encoded token. Any unbroken run
// of 80 token characters is taken for one; nothing in the app's data looks like that.
const SWID_PATTERN = /\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}/i;
const TOKEN_PATTERN = /[A-Za-z0-9%+/=]{80,}/;

// Everything in the scrubbed files that could identify the real league: its names (as whole words
// in any string, ignoring case), a fantasy team still under a name that isn't a demo one, its id, the
// cookies (by shape, and by value when they're given), and ESPN's uploaded-logo host. Abbreviations
// are only checked on the teams themselves, since short ones also turn up as ordinary words.
export function findLeaks(
  files: readonly { path: string; json: unknown }[],
  identity: Identity,
  secrets: { leagueId: number; espnS2?: string; swid?: string },
): Leak[] {
  const leaks: Leak[] = [];
  const { teamNames, owners, leagueNames } = identity.originals;
  // Whole words only, so a manager called Kevin Smith doesn't catch a player called Kevin Smithers.
  const names = [
    ...teamNames.map((name) => ({ text: name, what: 'team name' })),
    ...owners.map((name) => ({ text: name, what: 'manager name' })),
    ...leagueNames.map((name) => ({ text: name, what: 'league name' })),
  ]
    .filter(({ text }) => text.trim().length >= 3)
    .map(({ text, what }) => ({
      pattern: new RegExp(`(?<![\\p{L}\\p{N}])${text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu'),
      what: `${what} "${text}"`,
    }));
  const demoNames = new Set(DEMO_TEAMS.map((t) => t.name));
  const demoAbbrevs = new Set(DEMO_TEAMS.map((t) => t.abbrev));
  const leagueIdPattern = new RegExp(`(?<![0-9])${secrets.leagueId}(?![0-9])`);

  for (const { path, json } of files) {
    const text = JSON.stringify(json);
    const lower = text.toLowerCase();
    for (const { pattern, what } of names) {
      if (pattern.test(text)) leaks.push({ path, what });
    }
    if (leagueIdPattern.test(text)) leaks.push({ path, what: 'the league id' });
    if (SWID_PATTERN.test(text)) leaks.push({ path, what: 'something shaped like a SWID' });
    if (TOKEN_PATTERN.test(text)) leaks.push({ path, what: 'something shaped like an espn_s2 cookie' });
    if (secrets.swid && text.includes(secrets.swid)) leaks.push({ path, what: 'the SWID' });
    if (secrets.espnS2 && text.includes(secrets.espnS2)) leaks.push({ path, what: 'the espn_s2 cookie' });
    if (lower.includes('mystique-api')) leaks.push({ path, what: 'an uploaded-logo link' });

    visit(json, (value) => {
      if (!isFantasyTeam(value)) return;
      const name = value['name'] as string;
      const abbrev = value['abbrev'];
      if (!demoNames.has(name)) leaks.push({ path, what: `team ${value['teamId']} named "${name}"` });
      if (typeof abbrev === 'string' && !demoAbbrevs.has(abbrev)) {
        leaks.push({ path, what: `team ${value['teamId']} abbreviated "${abbrev}"` });
      }
    });
  }
  return leaks;
}

function visit(value: unknown, onObject: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, onObject));
  } else if (value !== null && typeof value === 'object') {
    onObject(value as Record<string, unknown>);
    Object.values(value).forEach((field) => visit(field, onObject));
  }
}
