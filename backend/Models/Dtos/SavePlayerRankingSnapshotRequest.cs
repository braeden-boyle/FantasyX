using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

// One league's player rankings for a scoring period and projection source, as the capture script
// builds them (utils/player-rankings.ts, snapshotPayload). ReplacementLevels maps position to points.
public record SavePlayerRankingSnapshotRequest(
    [Range(1, long.MaxValue, ErrorMessage = "leagueId is required")] long LeagueId,
    [Range(2018, 2100)] int Season,
    [Range(1, 25)] int ScoringPeriod,
    [Required, RegularExpression("^(ESPN|FANTASYX)$")] string ProjectionSource,
    [Range(1, 25)] int FirstWeek,
    [Range(1, 25)] int LastWeek,
    [Required] IReadOnlyDictionary<string, double> ReplacementLevels,
    [Required, MinLength(1), MaxLength(2000)] IReadOnlyList<PlayerRankingSnapshotEntryDto> Entries);

// PlayerId is not range-checked: D/ST "players" have negative ids. FantasyTeamId is null unless
// Status is "ROSTERED". WeeklyProjections maps week to points.
public record PlayerRankingSnapshotEntryDto(
    int PlayerId,
    [Required] string Position,
    int? FantasyTeamId,
    [Required, RegularExpression("^(ROSTERED|FREEAGENT|WAIVERS)$")] string Status,
    [Range(1, int.MaxValue)] int Rank,
    [Range(1, int.MaxValue)] int PositionRank,
    double RestOfSeasonPoints,
    double Value,
    [Required] IReadOnlyDictionary<int, double> WeeklyProjections);

// Created is false when a snapshot for the same league, season, scoring period and source already
// existed; nothing was written then, and SnapshotId is the existing one's.
public record PlayerRankingSnapshotSavedDto(long SnapshotId, bool Created);
