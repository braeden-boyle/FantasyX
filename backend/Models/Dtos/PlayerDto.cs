namespace FantasyX.Backend.Models.Dtos;

public record PlayerDto(
    int PlayerId,
    string FullName,
    string Position,
    string ProTeam,
    string Slot,
    bool Starter,
    string? InjuryStatus,
    string HeadshotUrl);
