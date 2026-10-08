using System.Text.Json;

namespace FantasyX.Backend.Models.Espn;

// From ESPN's public NFL scoreboard (site.api.espn.com/.../nfl/scoreboard), not the fantasy API.
// Competitor ids are ESPN team ids, the same numbering as the fantasy API's proTeamId.
public record EspnNflScoreboardResponse(List<EspnNflEvent>? Events);

public record EspnNflEvent(List<EspnNflCompetition>? Competitions, EspnNflStatus? Status);

public record EspnNflCompetition(List<EspnNflCompetitor>? Competitors, EspnNflSituation? Situation);

public record EspnNflCompetitor(string? Id);

// Only sent while a game is in progress. possession is the team id with the ball; it's read as raw
// JSON because it hasn't been seen live yet, so a number instead of a string can't break the parse.
public record EspnNflSituation(JsonElement? Possession, bool? IsRedZone);

// period is 1-4 for quarters and 5+ for overtime; displayClock is e.g. "4:12".
public record EspnNflStatus(int? Period, string? DisplayClock, EspnNflStatusType? Type);

// state is "pre", "in" or "post"; name is e.g. "STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD".
public record EspnNflStatusType(string? Name, string? State, bool? Completed);
