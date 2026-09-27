namespace FantasyX.Backend.Models.Dtos;

// Team is always the requested team. Opponent is null when it has no matchup this period (a bye,
// or eliminated from the playoffs). Points are totals for the whole matchup period, while each
// player's points are for ScoringPeriod only; the two differ in multi-week playoff rounds.
public record MatchupDetailDto(
    string LeagueName,
    int MatchupPeriod,
    int ScoringPeriod,
    MatchupTeamDto Team,
    MatchupTeamDto? Opponent);

// ProjectedPoints is null when ESPN doesn't send a live projection (e.g. a completed period).
public record MatchupTeamDto(TeamDto Team, string? LogoUrl, double Points, double? ProjectedPoints);
