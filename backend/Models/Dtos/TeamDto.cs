namespace FantasyX.Backend.Models.Dtos;

public record TeamDto(
    int TeamId,
    string Name,
    string Abbrev,
    string LeagueName,
    int Wins,
    int Losses,
    int Ties,
    int StandingRank,
    int LeagueSize,
    IReadOnlyList<PlayerDto> Players);
