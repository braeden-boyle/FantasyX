namespace FantasyX.Backend.Models.Dtos;

public record PlayerDto(
    int PlayerId,
    string FullName,
    string Position,
    string ProTeam,
    string Slot,
    bool Starter,
    string? InjuryStatus,
    string HeadshotUrl,
    bool IsTeamLogo,
    double ProjectedPoints,
    double Points,
    string? Opponent,
    bool? OpponentIsHome,
    DateTimeOffset? GameTimeUtc,
    int? OpponentPositionRank);
