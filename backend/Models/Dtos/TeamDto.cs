namespace FantasyX.Backend.Models.Dtos;

public record TeamDto(
    int TeamId,
    string Name,
    string Abbrev,
    int Wins,
    int Losses,
    int Ties,
    IReadOnlyList<PlayerDto> Players);
