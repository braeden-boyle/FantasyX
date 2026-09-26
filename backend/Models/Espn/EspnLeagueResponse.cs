namespace FantasyX.Backend.Models.Espn;

// ESPN's fantasy API returns far more fields than these; only what we use is modeled here.
public record EspnLeagueResponse(
    List<EspnTeam>? Teams,
    EspnStatus? Status,
    EspnPositionAgainstOpponent? PositionAgainstOpponent,
    EspnSettings? Settings,
    List<EspnMember>? Members,
    List<EspnScheduleEntry>? Schedule);

// Only populated when the "mSettings" view is requested.
public record EspnSettings(string? Name);

// PlayoffSeed doubles as the team's current standing rank within the league. Owners holds member
// ids (SWIDs) that match EspnMember.Id.
public record EspnTeam(
    int Id,
    string? Abbrev,
    string? Name,
    string? Location,
    string? Nickname,
    EspnRecord? Record,
    EspnRoster? Roster,
    int? PlayoffSeed,
    string? Logo,
    List<string>? Owners);

public record EspnRecord(EspnOverallRecord? Overall);

// Points and streak fields are only populated when the "mStandings" view is requested.
// StreakType is "WIN", "LOSS" or "TIE".
public record EspnOverallRecord(
    int Wins,
    int Losses,
    int Ties,
    double? PointsFor,
    double? PointsAgainst,
    int? StreakLength,
    string? StreakType);

// League members; only populated when the "mTeam" view is requested.
public record EspnMember(string? Id, string? DisplayName, string? FirstName, string? LastName);

// One head-to-head matchup; only populated when the "mMatchupScore" view is requested. Away is
// null for a bye. The *Live totals are only filled in by the "mScoreboard" view.
public record EspnScheduleEntry(int MatchupPeriodId, EspnMatchupSide? Home, EspnMatchupSide? Away);

public record EspnMatchupSide(
    int TeamId, double? TotalPoints, double? TotalPointsLive, double? TotalProjectedPointsLive);

public record EspnRoster(List<EspnRosterEntry>? Entries);

public record EspnRosterEntry(int PlayerId, int LineupSlotId, EspnPlayerPoolEntry PlayerPoolEntry);

public record EspnPlayerPoolEntry(EspnPlayer Player);

public record EspnPlayer(
    int Id, string FullName, int DefaultPositionId, int ProTeamId, string? InjuryStatus, List<EspnPlayerStat>? Stats);

// statSourceId 0 = actual, 1 = projected; statSplitTypeId 0 = season total, 1 = single week.
// ESPN ignores season filters, so SeasonId is needed to drop last season's entries. For weekly actuals,
// ExternalId is the pro game id and ProTeamId the team the player played that game for.
public record EspnPlayerStat(
    int? ScoringPeriodId,
    int? StatSourceId,
    double? AppliedTotal,
    int? SeasonId,
    int? StatSplitTypeId,
    string? ExternalId,
    int? ProTeamId,
    Dictionary<string, double>? Stats,
    Dictionary<string, double>? AppliedStats);

// The current live/upcoming week; only populated when the "mStatus" view is requested. A matchup
// period can span more than one scoring period (e.g. two-week playoff rounds).
public record EspnStatus(int? LatestScoringPeriod, int? CurrentMatchupPeriod);

// Defense-vs-position rankings; only populated when the "mPositionalRatings" view is requested.
// Keyed by default position id, then by opposing pro team id, both as strings (ESPN's own encoding).
public record EspnPositionAgainstOpponent(Dictionary<string, EspnPositionalRating>? PositionalRatings);

public record EspnPositionalRating(Dictionary<string, EspnRatingByOpponent>? RatingsByOpponent);

public record EspnRatingByOpponent(int Rank);
