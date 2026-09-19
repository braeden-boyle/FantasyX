using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

public record ImportTeamRequest(
    [Range(1, long.MaxValue, ErrorMessage = "leagueId is required")] long LeagueId,
    [Range(2018, 2100)] int Season,
    [Range(1, int.MaxValue, ErrorMessage = "teamId is required")] int TeamId,
    string? EspnS2,
    string? Swid);
