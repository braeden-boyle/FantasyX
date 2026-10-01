namespace FantasyX.Backend.Models.Dtos;

// Schedule is every regular-season matchup, played or not, for power rankings and playoff odds; a
// period before CurrentMatchupPeriod is complete. RegularSeasonMatchupPeriods and PlayoffTeamCount
// are 0 when ESPN doesn't send them. PlayoffSeedingRule is ESPN's tiebreaker name, e.g.
// "TOTAL_POINTS_SCORED" or "H2H_RECORD".
public record LeagueDto(
    string LeagueName,
    int CurrentMatchupPeriod,
    IReadOnlyList<StandingDto> Standings,
    IReadOnlyList<MatchupDto> Matchups,
    int RegularSeasonMatchupPeriods,
    int PlayoffTeamCount,
    string? PlayoffSeedingRule,
    IReadOnlyList<ScheduledMatchupDto> Schedule);

// Streak is compact, e.g. "W3" or "L1"; null when ESPN has no streak yet.
public record StandingDto(
    int TeamId,
    int Seed,
    string Name,
    string Abbrev,
    string? LogoUrl,
    IReadOnlyList<string> Owners,
    int Wins,
    int Losses,
    int Ties,
    double PointsFor,
    double PointsAgainst,
    string? Streak,
    int DivisionId);

public record MatchupDto(MatchupSideDto Home, MatchupSideDto Away);

// ProjectedPoints is null when ESPN doesn't send a live projection (e.g. a completed period).
public record MatchupSideDto(int TeamId, double Points, double? ProjectedPoints);

// AwayTeamId and AwayPoints are null for a bye. Winner is "HOME", "AWAY", "TIE" or "UNDECIDED".
public record ScheduledMatchupDto(
    int MatchupPeriod, int HomeTeamId, int? AwayTeamId, double HomePoints, double? AwayPoints, string Winner);
