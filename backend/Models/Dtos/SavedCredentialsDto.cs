namespace FantasyX.Backend.Models.Dtos;

public record SavedCredentialsDto(
    string EspnS2,
    string Swid,
    long? LastLeagueId,
    int? LastSeason,
    int? LastTeamId);
