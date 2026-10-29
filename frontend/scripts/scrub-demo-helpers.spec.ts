import { describe, expect, it } from 'vitest';
import { League, Standing, TeamSummary } from '../src/app/models/team.model';
import { DEMO_LEAGUE_NAME, DEMO_OWNERS, DEMO_TEAMS, FALLBACK_OWNER } from './demo-names';
import { buildIdentity, findLeaks, isPresetLogo, scrubValue } from './scrub-demo-helpers';

const UPLOADED_LOGO = 'https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/abc123';
const PRESET_LOGO = 'https://g.espncdn.com/lm-static/logo-packs/core/Helmets/helmet-07.svg';

function standing(teamId: number, name: string, abbrev: string, owners: string[], logoUrl: string | null): Standing {
  return {
    teamId,
    seed: teamId,
    name,
    abbrev,
    logoUrl,
    owners,
    wins: 4,
    losses: 3,
    ties: 0,
    pointsFor: 800,
    pointsAgainst: 790,
    streak: 'W1',
    divisionId: 0,
    waiverRank: teamId,
    budgetSpent: null,
  };
}

// A made-up "real" league to scrub. Team 2's abbreviation is also an NFL team's, and team 3 has two
// managers, one of whom also runs team 1.
const standings = [
  standing(3, 'Kevin’s Krew', 'KK', ['Kevin Smith', 'Alicia Brown'], UPLOADED_LOGO),
  standing(1, 'Sunday Scaries', 'SCAR', ['Alicia Brown'], PRESET_LOGO),
  standing(2, 'Buffalo Wingmen', 'BUF', ['Marcus Lee'], 'https://example.com/our-group-photo.jpg'),
];
const league = { leagueName: 'Office League 2026', standings } as League;
const teams: TeamSummary[] = standings.map(({ teamId, name, abbrev }) => ({ teamId, name, abbrev }));
const identity = buildIdentity([{ teams, league }]);

describe('buildIdentity', () => {
  it('names teams in teamId order and managers in the order first met', () => {
    expect(identity.teams.get(1)).toEqual(DEMO_TEAMS[0]);
    expect(identity.teams.get(3)).toEqual(DEMO_TEAMS[2]);
    expect(identity.owners.get('Alicia Brown')).toBe(DEMO_OWNERS[0]);
    expect(identity.owners.get('Marcus Lee')).toBe(DEMO_OWNERS[1]);
    expect(identity.owners.get('Kevin Smith')).toBe(DEMO_OWNERS[2]);
  });

  it('gives a team the same name in both scenarios', () => {
    const both = buildIdentity([
      { teams, league },
      { teams: [...teams].reverse(), league: { ...league, standings: [...standings].reverse() } },
    ]);
    expect([...both.teams]).toEqual([...identity.teams]);
  });

  it('refuses a league bigger than the list of names', () => {
    const big = Array.from({ length: DEMO_TEAMS.length + 1 }, (_, i) => standing(i + 1, `Team ${i}`, `T${i}`, [], null));
    expect(() => buildIdentity([{ teams: [], league: { ...league, standings: big } }])).toThrow();
  });
});

describe('isPresetLogo', () => {
  it('keeps ESPN’s preset logos only', () => {
    expect(isPresetLogo(PRESET_LOGO)).toBe(true);
    expect(isPresetLogo(UPLOADED_LOGO)).toBe(false);
    expect(isPresetLogo('https://example.com/logo.png')).toBe(false);
    expect(isPresetLogo('not a url')).toBe(false);
  });
});

describe('scrubValue', () => {
  it('renames fantasy teams, managers and the league, and drops non-preset logos, at any depth', () => {
    const scrubbed = scrubValue({ leagueName: league.leagueName, standings }, identity) as League;
    expect(scrubbed.leagueName).toBe(DEMO_LEAGUE_NAME);
    expect(scrubbed.standings.map((s) => [s.teamId, s.name, s.abbrev])).toEqual([
      [3, DEMO_TEAMS[2].name, DEMO_TEAMS[2].abbrev],
      [1, DEMO_TEAMS[0].name, DEMO_TEAMS[0].abbrev],
      [2, DEMO_TEAMS[1].name, DEMO_TEAMS[1].abbrev],
    ]);
    expect(scrubbed.standings[0].owners).toEqual([DEMO_OWNERS[2], DEMO_OWNERS[0]]);
    expect(scrubbed.standings.map((s) => s.logoUrl)).toEqual([null, PRESET_LOGO, null]);
    // Everything else is untouched.
    expect(scrubbed.standings[0].pointsFor).toBe(800);
  });

  it('leaves NFL teams and players alone, even sharing a fantasy team’s abbreviation', () => {
    const week = {
      leagueName: league.leagueName,
      teams: [{ team: { teamId: 2, name: 'Buffalo Wingmen', abbrev: 'BUF', players: [{ playerId: 9, proTeam: 'BUF' }] }, logoUrl: UPLOADED_LOGO }],
      nflGames: [{ home: { proTeamId: 2, abbrev: 'BUF', name: 'Bills' } }],
    };
    const scrubbed = scrubValue(week, identity) as typeof week;
    expect(scrubbed.teams[0].team.name).toBe(DEMO_TEAMS[1].name);
    expect(scrubbed.teams[0].team.players[0].proTeam).toBe('BUF');
    expect(scrubbed.teams[0].logoUrl).toBeNull();
    expect(scrubbed.nflGames[0].home).toEqual({ proTeamId: 2, abbrev: 'BUF', name: 'Bills' });
  });

  it('shows an unknown manager as the fallback, and refuses an unknown team', () => {
    expect(scrubValue({ owners: ['Someone New'] }, identity)).toEqual({ owners: [FALLBACK_OWNER] });
    expect(() => scrubValue({ teamId: 99, name: 'Ghost Team' }, identity)).toThrow();
  });

  it('doesn’t change its input', () => {
    const input = { leagueName: 'Office League 2026' };
    scrubValue(input, identity);
    expect(input.leagueName).toBe('Office League 2026');
  });
});

describe('findLeaks', () => {
  const secrets = { leagueId: 48213907 };
  const clean = scrubValue({ leagueName: league.leagueName, standings }, identity);
  const leaksIn = (json: unknown, extra: Partial<typeof secrets & { espnS2: string; swid: string }> = {}) =>
    findLeaks([{ path: 'x.json', json }], identity, { ...secrets, ...extra }).map((l) => l.what);

  it('finds nothing in a clean scrub, even with an NFL abbreviation in it', () => {
    expect(leaksIn(clean)).toEqual([]);
    expect(leaksIn({ proTeam: 'BUF', fullName: 'Kevin Smithers', eventId: '401772938' })).toEqual([]);
  });

  it('finds real names inside any string, ignoring case', () => {
    expect(leaksIn({ text: 'a trade with sunday scaries' })).toEqual(['team name "Sunday Scaries"']);
    expect(leaksIn({ note: 'Kevin Smith' })).toEqual(['manager name "Kevin Smith"']);
    expect(leaksIn({ x: 'Office League 2026' })).toEqual(['league name "Office League 2026"']);
  });

  it('finds a fantasy team under a name or abbreviation that isn’t a demo one', () => {
    expect(leaksIn({ teamId: 1, name: DEMO_TEAMS[0].name, abbrev: 'SCAR' })).toEqual(['team 1 abbreviated "SCAR"']);
    expect(leaksIn({ teamId: 1, name: 'Somebody', abbrev: DEMO_TEAMS[0].abbrev })).toEqual(['team 1 named "Somebody"']);
  });

  it('finds the league id, cookies and uploaded logos', () => {
    expect(leaksIn({ url: '/leagues/48213907/x' })).toEqual(['the league id']);
    expect(leaksIn({ id: 148213907 })).toEqual([]);
    expect(leaksIn({ swid: '{2F1A3B4C-5D6E-4F70-8192-A3B4C5D6E7F8}' })).toEqual(['something shaped like a SWID']);
    expect(leaksIn({ s2: `AE${'Bx9%2F'.repeat(20)}` })).toEqual(['something shaped like an espn_s2 cookie']);
    expect(leaksIn({ s2: 'short-secret' }, { espnS2: 'short-secret' })).toEqual(['the espn_s2 cookie']);
    expect(leaksIn({ logo: UPLOADED_LOGO })).toEqual(['an uploaded-logo link']);
  });
});
