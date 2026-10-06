namespace FantasyX.Backend.Models.Dtos;

// A free agent or waiver player, for player rankings. Identity matches PlayerDto; Weeks, Upcoming and
// Schedule follow PlayerHistoryDto's rules (weeks before the requested scoring period played while projected
// above 0, and ESPN's projection for that period on). Status is "FREEAGENT" or "WAIVERS". Points
// is what the player has scored in the requested scoring period so far (0 before they play).
public record AvailablePlayerDto(
    int PlayerId,
    string FullName,
    string Position,
    string ProTeam,
    string? InjuryStatus,
    string HeadshotUrl,
    bool IsTeamLogo,
    string Status,
    double PercentOwned,
    double Points,
    IReadOnlyList<PlayerHistoryWeekDto> Weeks,
    IReadOnlyList<PlayerProjectionWeekDto> Upcoming,
    IReadOnlyList<PlayerScheduleWeekDto> Schedule);
