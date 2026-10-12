namespace FantasyX.Backend.Models.Dtos;

// One NFL game from ESPN's scoreboard. State is "pre", "in" or "post". Detail is the quarter and clock
// ("Q3 4:12", "Half"), only while in progress. StatusText is ESPN's own line ("10/12 - 8:15 PM EDT",
// "Final", "Final/OT"). PossessionTeam (abbreviation), RedZone, DownDistance ("3rd & 7 at ARI 21")
// and LastPlay are only set while in progress, and only when ESPN says.
public record NflGameDto(
    string EventId,
    DateTimeOffset? KickoffUtc,
    string State,
    string? Detail,
    string StatusText,
    NflGameTeamDto Away,
    NflGameTeamDto Home,
    string? PossessionTeam,
    bool RedZone,
    string? DownDistance,
    string? LastPlay,
    string? Broadcast);

// Abbrev matches PlayerDto.ProTeam. Score is null before kickoff. Linescores (points per quarter, then
// overtime) are only filled in on the game summary.
public record NflGameTeamDto(
    int ProTeamId,
    string Abbrev,
    string Name,
    int? Score,
    string? Record,
    IReadOnlyList<string> Linescores);
