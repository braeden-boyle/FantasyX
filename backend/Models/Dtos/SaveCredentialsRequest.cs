using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

public record SaveCredentialsRequest(
    [Required] string EspnS2,
    [Required] string Swid,
    long? LastLeagueId,
    int? LastSeason,
    int? LastTeamId);
