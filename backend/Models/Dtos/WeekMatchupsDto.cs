namespace FantasyX.Backend.Models.Dtos;

// Every team's roster and score for the current matchup period, plus who plays whom, so a client
// can switch between matchups without another request. A team missing from Matchups has no
// matchup this period (e.g. eliminated from the playoffs). Points are totals for the whole matchup
// period, while each player's points are for ScoringPeriod only; the two differ in multi-week
// playoff rounds, which ScoringPeriodsInMatchup > 1 flags.
public record WeekMatchupsDto(
    string LeagueName,
    int MatchupPeriod,
    int ScoringPeriod,
    int ScoringPeriodsInMatchup,
    IReadOnlyList<MatchupTeamDto> Teams,
    IReadOnlyList<MatchupPairDto> Matchups);

// Points are 0 and ProjectedPoints null for a team with no matchup. ProjectedPoints is also null
// when ESPN doesn't send a live projection (e.g. a completed period).
public record MatchupTeamDto(TeamDto Team, string? LogoUrl, double Points, double? ProjectedPoints);

// AwayTeamId is null for a bye.
public record MatchupPairDto(int HomeTeamId, int? AwayTeamId);
