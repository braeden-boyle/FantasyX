using System.Text.Json;

namespace FantasyX.Backend.Models.Espn;

// From ESPN's public NFL scoreboard (site.api.espn.com/.../nfl/scoreboard), not the fantasy API.
// Competitor ids are ESPN team ids, the same numbering as the fantasy API's proTeamId.
public record EspnNflScoreboardResponse(List<EspnNflEvent>? Events, EspnNflWeek? Week);

public record EspnNflWeek(List<EspnNflTeam>? TeamsOnBye);

// date is e.g. "2026-10-16T00:15Z" (no seconds), so it's parsed by hand rather than as a DateTimeOffset.
public record EspnNflEvent(string? Id, string? Date, List<EspnNflCompetition>? Competitions, EspnNflStatus? Status);

public record EspnNflCompetition(
    List<EspnNflCompetitor>? Competitors,
    EspnNflSituation? Situation,
    List<EspnNflBroadcast>? Broadcasts);

// score is a string ("21"), and "0" before kickoff.
public record EspnNflCompetitor(
    string? Id,
    string? HomeAway,
    string? Score,
    EspnNflTeam? Team,
    List<EspnNflRecord>? Records);

public record EspnNflTeam(string? Id, string? Abbreviation, string? DisplayName);

// The first record is the overall one ("3-2", "3-1-1").
public record EspnNflRecord(string? Type, string? Summary);

public record EspnNflBroadcast(List<string>? Names);

// Only sent while a game is in progress. possession is the team id with the ball; it's read as raw
// JSON because it hasn't been seen live yet, so a number instead of a string can't break the parse.
// downDistanceText ("3rd & 7 at ARI 21") and lastPlay ({ text, ... }) are raw JSON for the same reason.
public record EspnNflSituation(
    JsonElement? Possession,
    bool? IsRedZone,
    JsonElement? DownDistanceText,
    JsonElement? LastPlay);

// period is 1-4 for quarters and 5+ for overtime; displayClock is e.g. "4:12".
public record EspnNflStatus(int? Period, string? DisplayClock, EspnNflStatusType? Type);

// state is "pre", "in" or "post"; name is e.g. "STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD".
// shortDetail is what ESPN shows on its scoreboard: "10/12 - 8:15 PM EDT", "Final", "Final/OT".
public record EspnNflStatusType(string? Name, string? State, bool? Completed, string? ShortDetail);
