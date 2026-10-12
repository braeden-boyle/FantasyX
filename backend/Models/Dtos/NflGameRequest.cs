using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

// EventId is ESPN's NFL game id (from NflGameDto). ScoringPeriod is the NFL week, used to score the
// game's players with the league's settings.
public record NflGameRequest(
    [Range(1, long.MaxValue, ErrorMessage = "leagueId is required")] long LeagueId,
    [Range(2018, 2100)] int Season,
    [Range(1, 25)] int ScoringPeriod,
    [Required, RegularExpression(@"^\d{1,12}$", ErrorMessage = "eventId must be an ESPN game id")] string EventId,
    string? EspnS2,
    string? Swid);
