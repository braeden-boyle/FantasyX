namespace FantasyX.Backend.Models.Espn;

// From ESPN's public NFL game summary (site.api.espn.com/.../nfl/summary?event={id}). The full payload
// is around 600 KB (news, odds, win probability, ...); only the parts below are read. Before kickoff
// there are no drives or scoring plays, and the box score has no players.
public record EspnNflSummaryResponse(
    EspnNflSummaryHeader? Header,
    EspnNflBoxscore? Boxscore,
    EspnNflDrives? Drives,
    List<EspnNflPlay>? ScoringPlays,
    EspnNflSituation? Situation);

public record EspnNflSummaryHeader(List<EspnNflSummaryCompetition>? Competitions);

public record EspnNflSummaryCompetition(
    string? Date,
    List<EspnNflSummaryCompetitor>? Competitors,
    EspnNflStatus? Status,
    List<EspnNflSummaryBroadcast>? Broadcasts);

// Unlike the scoreboard, the summary calls the records "record". possession is set on the team with
// the ball while the game is in progress.
public record EspnNflSummaryCompetitor(
    string? Id,
    string? HomeAway,
    string? Score,
    EspnNflTeam? Team,
    List<EspnNflRecord>? Record,
    List<EspnNflLinescore>? Linescores,
    bool? Possession);

public record EspnNflLinescore(string? DisplayValue);

public record EspnNflSummaryBroadcast(EspnNflBroadcastMedia? Media);

public record EspnNflBroadcastMedia(string? ShortName);

public record EspnNflBoxscore(List<EspnNflBoxscoreTeam>? Teams, List<EspnNflBoxscorePlayers>? Players);

// Team totals as label/value pairs: "Total Yards" "412", "3rd down efficiency" "4-13", ...
public record EspnNflBoxscoreTeam(EspnNflTeam? Team, List<EspnNflTeamStat>? Statistics);

public record EspnNflTeamStat(string? Label, string? DisplayValue);

public record EspnNflBoxscorePlayers(EspnNflTeam? Team, List<EspnNflStatCategory>? Statistics);

// name is "passing", "rushing", "receiving", "kicking", ...; each athlete's stats line up with labels.
public record EspnNflStatCategory(
    string? Name,
    List<string>? Labels,
    List<EspnNflAthleteStats>? Athletes,
    List<string>? Totals);

public record EspnNflAthleteStats(EspnNflAthlete? Athlete, List<string>? Stats);

// Athlete ids are the same as fantasy player ids.
public record EspnNflAthlete(string? Id, string? DisplayName);

// current is only sent while a game is in progress.
public record EspnNflDrives(EspnNflDrive? Current, List<EspnNflDrive>? Previous);

// description is e.g. "7 plays, 54 yards, 3:12".
public record EspnNflDrive(string? Description, EspnNflTeam? Team, List<EspnNflPlay>? Plays);

// Scoring plays carry the team and the score after the play; plays inside a drive have neither team
// nor (always) a score, so the drive's team stands in.
public record EspnNflPlay(
    string? Text,
    EspnNflPlayType? Type,
    EspnNflPeriod? Period,
    EspnNflClock? Clock,
    bool? ScoringPlay,
    EspnNflTeam? Team,
    int? AwayScore,
    int? HomeScore,
    EspnNflPlayStart? Start);

public record EspnNflPlayType(string? Text);

public record EspnNflPeriod(int? Number);

public record EspnNflClock(string? DisplayValue);

// downDistanceText is e.g. "3rd & 7 at ARI 21".
public record EspnNflPlayStart(string? DownDistanceText);
