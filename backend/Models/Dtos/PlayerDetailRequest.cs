using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

// PlayerId is not range-checked: D/ST "players" have negative ids (e.g. -16026).
public record PlayerDetailRequest(
    [Range(1, long.MaxValue, ErrorMessage = "leagueId is required")] long LeagueId,
    [Range(2018, 2100)] int Season,
    int PlayerId,
    string? EspnS2,
    string? Swid);
