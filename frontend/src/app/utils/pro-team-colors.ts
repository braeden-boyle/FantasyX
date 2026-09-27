// NFL teams' primary and secondary colours, keyed by the abbreviations the backend sends
// (EspnLookups.ProTeams). Used to draw D/ST badges instead of the teams' logos.
export interface ProTeamColors {
  primary: string;
  secondary: string;
}

const PRO_TEAM_COLORS: Record<string, ProTeamColors> = {
  ARI: { primary: '#97233F', secondary: '#000000' },
  ATL: { primary: '#A71930', secondary: '#000000' },
  BAL: { primary: '#241773', secondary: '#9E7C0C' },
  BUF: { primary: '#00338D', secondary: '#C60C30' },
  CAR: { primary: '#0085CA', secondary: '#101820' },
  CHI: { primary: '#0B162A', secondary: '#C83803' },
  CIN: { primary: '#FB4F14', secondary: '#000000' },
  CLE: { primary: '#311D00', secondary: '#FF3C00' },
  DAL: { primary: '#003594', secondary: '#869397' },
  DEN: { primary: '#FB4F14', secondary: '#002244' },
  DET: { primary: '#0076B6', secondary: '#B0B7BC' },
  GB: { primary: '#203731', secondary: '#FFB612' },
  HOU: { primary: '#03202F', secondary: '#A71930' },
  IND: { primary: '#002C5F', secondary: '#A2AAAD' },
  JAX: { primary: '#006778', secondary: '#D7A22A' },
  KC: { primary: '#E31837', secondary: '#FFB81C' },
  LAC: { primary: '#0080C6', secondary: '#FFC20E' },
  LAR: { primary: '#003594', secondary: '#FFA300' },
  LV: { primary: '#000000', secondary: '#A5ACAF' },
  MIA: { primary: '#008E97', secondary: '#FC4C02' },
  MIN: { primary: '#4F2683', secondary: '#FFC62F' },
  NE: { primary: '#002244', secondary: '#C60C30' },
  NO: { primary: '#101820', secondary: '#D3BC8D' },
  NYG: { primary: '#0B2265', secondary: '#A71930' },
  NYJ: { primary: '#125740', secondary: '#FFFFFF' },
  PHI: { primary: '#004C54', secondary: '#A5ACAF' },
  PIT: { primary: '#101820', secondary: '#FFB612' },
  SEA: { primary: '#002244', secondary: '#69BE28' },
  SF: { primary: '#AA0000', secondary: '#B3995D' },
  TB: { primary: '#D50A0A', secondary: '#34302B' },
  TEN: { primary: '#0C2340', secondary: '#4B92DB' },
  WSH: { primary: '#5A1414', secondary: '#FFB612' },
};

// Unknown teams (free agents, or an abbreviation ESPN adds later) get a neutral grey badge.
const FALLBACK: ProTeamColors = { primary: '#4B5563', secondary: '#9CA3AF' };

export function proTeamColors(abbrev: string): ProTeamColors {
  return PRO_TEAM_COLORS[abbrev] ?? FALLBACK;
}
