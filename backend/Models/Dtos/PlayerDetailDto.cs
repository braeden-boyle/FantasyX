using System.Text.Json.Serialization;

namespace FantasyX.Backend.Models.Dtos;

public record PlayerDetailDto(
    int PlayerId,
    string FullName,
    string Position,
    string ProTeam,
    string? InjuryStatus,
    string HeadshotUrl,
    bool IsTeamLogo,
    int CurrentWeek,
    PlayerSeasonSummaryDto Summary,
    IReadOnlyList<string> StatColumns,
    IReadOnlyList<PlayerGameDto> Games);

public record PlayerSeasonSummaryDto(
    double TotalPoints,
    double AveragePoints,
    int GamesPlayed,
    int? PositionRank,
    double SeasonProjection,
    double RestOfSeasonProjection);

// StatLine values line up index-for-index with PlayerDetailDto.StatColumns; null unless Status is Played.
public record PlayerGameDto(
    int Week,
    PlayerGameStatus Status,
    string? Opponent,
    bool? IsHome,
    DateTimeOffset? GameTimeUtc,
    int? OpponentPositionRank,
    double? ProjectedPoints,
    double? Points,
    IReadOnlyList<string>? StatLine);

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PlayerGameStatus
{
    Played,
    DidNotPlay,
    Bye,
    Upcoming,
}
