using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

// PlayerIds are not range-checked: D/ST "players" have negative ids. The cap covers every roster
// in a large league with room to spare.
public record PlayerHistoryRequest(
    [Range(1, long.MaxValue, ErrorMessage = "leagueId is required")] long LeagueId,
    [Range(2018, 2100)] int Season,
    [Range(1, 25)] int ScoringPeriod,
    [Required, MaxLength(400)] IReadOnlyList<int> PlayerIds,
    string? EspnS2,
    string? Swid);
