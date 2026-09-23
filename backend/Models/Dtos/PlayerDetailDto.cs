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

// StatLine values line up index-for-index with PlayerDetailDto.StatColumns. StatLine and
// ScoringBreakdown are null unless Status is Played (and ESPN sent per-stat points for the game).
public record PlayerGameDto(
    int Week,
    PlayerGameStatus Status,
    string? Opponent,
    bool? IsHome,
    DateTimeOffset? GameTimeUtc,
    int? OpponentPositionRank,
    double? ProjectedPoints,
    double? Points,
    IReadOnlyList<string>? StatLine,
    IReadOnlyList<ScoringLineDto>? ScoringBreakdown);

// One scoring stat's contribution to a game's points. StatValue is the raw stat (e.g. 248 passing
// yards, or the actual points allowed for a D/ST bracket); PointsEach is the per-unit rate, set only
// for stats that scale (yards, catches, TDs).
public record ScoringLineDto(string Label, double? StatValue, double? PointsEach, double Points);

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PlayerGameStatus
{
    Played,
    DidNotPlay,
    Bye,
    Upcoming,
}
