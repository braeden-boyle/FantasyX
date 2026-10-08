namespace FantasyX.Backend.Models.Dtos;

// StatLine is a compact summary of this week's stats (e.g. "5 REC, 84 YD, 1 TD"), null with none.
// GameState ("pre", "in" or "post") and GameDetail (e.g. "Q3 4:12", only while in progress) come
// from ESPN's NFL scoreboard and are null when it isn't fetched or has no game for the team.
// PossessionTeam is the pro team abbreviation with the ball in a game in progress, and RedZone whether
// it's inside the 20; null and false whenever the scoreboard doesn't say.
public record PlayerDto(
    int PlayerId,
    string FullName,
    string Position,
    string ProTeam,
    string Slot,
    bool Starter,
    string? InjuryStatus,
    string HeadshotUrl,
    bool IsTeamLogo,
    double ProjectedPoints,
    double Points,
    string? Opponent,
    bool? OpponentIsHome,
    DateTimeOffset? GameTimeUtc,
    int? OpponentPositionRank,
    bool GameFinal,
    string? StatLine,
    string? GameState,
    string? GameDetail,
    string? PossessionTeam,
    bool RedZone);
