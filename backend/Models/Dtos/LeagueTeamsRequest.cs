using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

public record LeagueTeamsRequest(
    [Range(1, long.MaxValue, ErrorMessage = "leagueId is required")] long LeagueId,
    [Range(2018, 2100)] int Season,
    string? EspnS2,
    string? Swid);
