namespace FantasyX.Backend.Models.Espn;

// From the separate, game-wide "seasons/{season}?view=proTeamSchedules_wl" endpoint (not league-scoped).
public record EspnProTeamSchedulesResponse(EspnProTeamSettings? Settings);

public record EspnProTeamSettings(List<EspnProTeamScheduleEntry>? ProTeams);

// Keyed by scoring period id (as a string), each holding that week's single game.
public record EspnProTeamScheduleEntry(int Id, Dictionary<string, List<EspnProGame>>? ProGamesByScoringPeriod);

public record EspnProGame(int HomeProTeamId, int AwayProTeamId, long Date);
