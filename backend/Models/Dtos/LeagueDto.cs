namespace FantasyX.Backend.Models.Dtos;

public record LeagueDto(
    string LeagueName,
    int CurrentMatchupPeriod,
    IReadOnlyList<StandingDto> Standings,
    IReadOnlyList<MatchupDto> Matchups);

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
    string? Streak);

public record MatchupDto(MatchupSideDto Home, MatchupSideDto Away);

// ProjectedPoints is null when ESPN doesn't send a live projection (e.g. a completed period).
public record MatchupSideDto(int TeamId, double Points, double? ProjectedPoints);
