// The made-up league the demo's real league is dressed as. Teams take these in teamId order and
// managers in the order they're first met, the same way in both scenarios, so a team keeps its name
// when the visitor switches between them. Abbreviations steer clear of NFL ones.

export const DEMO_LEAGUE_NAME = 'FantasyX Demo League';

export const DEMO_TEAMS: readonly { name: string; abbrev: string }[] = [
  { name: 'Gridiron Gnomes', abbrev: 'GNOM' },
  { name: 'Blitz Brigade', abbrev: 'BLTZ' },
  { name: 'Pick Six Pack', abbrev: 'PSIX' },
  { name: 'Hail Mary Heroes', abbrev: 'HAIL' },
  { name: 'End Zone Envy', abbrev: 'ENVY' },
  { name: 'Fourth & Forever', abbrev: '4TH' },
  { name: 'Fumble Factory', abbrev: 'FUMB' },
  { name: 'Red Zone Rascals', abbrev: 'RZR' },
  { name: 'Two-Minute Drill', abbrev: '2MIN' },
  { name: 'Waiver Wire Wizards', abbrev: 'WIRE' },
  { name: 'Bye Week Blues', abbrev: 'BYWK' },
  { name: 'Sack Attack', abbrev: 'SACK' },
  { name: 'Audible Alchemists', abbrev: 'AUDB' },
  { name: 'Play Action Pros', abbrev: 'PLAY' },
  { name: 'Goal Line Ghosts', abbrev: 'GHST' },
  { name: 'Flag on the Play', abbrev: 'FLAG' },
  { name: 'Onside Kickers', abbrev: 'ONSD' },
  { name: 'Monday Night Mayhem', abbrev: 'MAYH' },
  { name: 'Draft Day Dreamers', abbrev: 'DRFT' },
  { name: 'Taxi Squad Titans', abbrev: 'TAXI' },
];

export const DEMO_OWNERS: readonly string[] = [
  'Morgan Hale',
  'Priya Natarajan',
  'Sam Okafor',
  'Riley Brennan',
  'Dana Whitfield',
  'Casey Lindqvist',
  'Avery Moreno',
  'Jamie Kowalski',
  'Taylor Ashby',
  'Quinn Delacroix',
  'Rowan Ito',
  'Skyler Vance',
  'Harper Oduya',
  'Reese Calloway',
  'Emerson Patel',
  'Finley Abernathy',
  'Kendall Sorensen',
  'Blake Marchetti',
  'Parker Nakamura',
  'Hayden Ostrowski',
  'Logan Achebe',
  'Sasha Lindgren',
  'Jesse Valdivia',
  'Charlie Wexford',
];

// Who an owner beyond the list (a league with more managers than names) is shown as.
export const FALLBACK_OWNER = 'Demo Manager';
