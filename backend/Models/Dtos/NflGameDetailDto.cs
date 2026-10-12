namespace FantasyX.Backend.Models.Dtos;

// One NFL game's summary: ESPN's game page trimmed to what matters for fantasy. LastPlay is the most
// recent play (null before kickoff), CurrentDrive only while in progress. TeamStats and BoxScore are
// empty before kickoff. FantasyPlayers are both teams' players scored with the league's settings,
// best first; null when the league's player pool couldn't be read.
public record NflGameDetailDto(
    NflGameDto Game,
    NflPlayDto? LastPlay,
    NflDriveDto? CurrentDrive,
    IReadOnlyList<NflPlayDto> ScoringPlays,
    IReadOnlyList<NflTeamStatDto> TeamStats,
    IReadOnlyList<NflBoxScoreTeamDto> BoxScore,
    IReadOnlyList<NflFantasyPlayerDto>? FantasyPlayers);

// AwayScore and HomeScore are the score after the play, sent for scoring plays.
public record NflPlayDto(
    string Text,
    string? Type,
    int? Period,
    string? Clock,
    string? TeamAbbrev,
    bool Scoring,
    int? AwayScore,
    int? HomeScore,
    string? DownDistance);

// Description is e.g. "7 plays, 54 yards, 3:12".
public record NflDriveDto(string? TeamAbbrev, string? Description);

public record NflTeamStatDto(string Label, string Away, string Home);

public record NflBoxScoreTeamDto(string TeamAbbrev, IReadOnlyList<NflStatCategoryDto> Categories);

// Name is "passing", "rushing", "receiving" or "kicking". Each row's Stats and the Totals line up with
// Labels. PlayerId is the fantasy player id (ESPN uses the same ids), null if ESPN didn't send one.
public record NflStatCategoryDto(
    string Name,
    IReadOnlyList<string> Labels,
    IReadOnlyList<NflStatRowDto> Rows,
    IReadOnlyList<string> Totals);

public record NflStatRowDto(int? PlayerId, string Name, IReadOnlyList<string> Stats);

// Identity matches PlayerDto. Points are this week's under the league's scoring (0 before they play),
// ProjectedPoints ESPN's projection for the week. StatLine is the same summary as PlayerDto's.
public record NflFantasyPlayerDto(
    int PlayerId,
    string FullName,
    string Position,
    string ProTeam,
    string? InjuryStatus,
    string HeadshotUrl,
    bool IsTeamLogo,
    double Points,
    double? ProjectedPoints,
    string? StatLine);
