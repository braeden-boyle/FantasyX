using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

// Positions are the league's starting positions by name ("QB", "RB", "WR", "TE", "K", "D/ST"); each
// gets its own ESPN call for its PerPosition most-owned free agents and waiver players.
public record AvailablePlayersRequest(
    [Range(1, long.MaxValue, ErrorMessage = "leagueId is required")] long LeagueId,
    [Range(2018, 2100)] int Season,
    [Range(1, 25)] int ScoringPeriod,
    [Required, MinLength(1), MaxLength(6)] IReadOnlyList<string> Positions,
    [Range(1, 100)] int PerPosition,
    string? EspnS2,
    string? Swid);
