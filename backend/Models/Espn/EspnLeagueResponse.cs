namespace FantasyX.Backend.Models.Espn;

// ESPN's fantasy API returns far more fields than these; only what we use is modeled here.
public record EspnLeagueResponse(
    List<EspnTeam>? Teams,
    EspnStatus? Status,
    EspnPositionAgainstOpponent? PositionAgainstOpponent,
    EspnSettings? Settings,
    List<EspnMember>? Members,
    List<EspnScheduleEntry>? Schedule,
    EspnDraftDetail? DraftDetail);

// Only populated when the "mSettings" view is requested.
public record EspnSettings(string? Name, EspnScheduleSettings? ScheduleSettings, EspnRosterSettings? RosterSettings);

// Lineup slot counts, keyed by lineup slot id as a string (bench and IR included).
public record EspnRosterSettings(Dictionary<string, int>? LineupSlotCounts);

// Only populated when the "mDraftDetail" view is requested. Picks is empty before the draft.
public record EspnDraftDetail(bool? Drafted, List<EspnDraftPick>? Picks);

public record EspnDraftPick(int PlayerId, int TeamId, int OverallPickNumber);

// Scoring period ids in each matchup period, keyed by matchup period id as a string. A playoff
// round can span more than one scoring period. MatchupPeriodCount is the number of regular-season
// matchup periods; PlayoffSeedingRule is ESPN's tiebreaker name, e.g. "TOTAL_POINTS_SCORED" or
// "H2H_RECORD".
public record EspnScheduleSettings(
    Dictionary<string, List<int>>? MatchupPeriods,
    int? MatchupPeriodCount,
    int? PlayoffTeamCount,
    string? PlayoffSeedingRule);

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
    List<string>? Owners,
    int? DivisionId);

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
// null for a bye. The *Live totals are only filled in by the "mScoreboard" view. Winner is "HOME",
// "AWAY", "TIE" or "UNDECIDED".
public record EspnScheduleEntry(int MatchupPeriodId, EspnMatchupSide? Home, EspnMatchupSide? Away, string? Winner);

public record EspnMatchupSide(
    int TeamId, double? TotalPoints, double? TotalPointsLive, double? TotalProjectedPointsLive);

public record EspnRoster(List<EspnRosterEntry>? Entries);

public record EspnRosterEntry(int PlayerId, int LineupSlotId, EspnPlayerPoolEntry PlayerPoolEntry);

public record EspnPlayerPoolEntry(EspnPlayer Player);

// Ownership is league-wide (across ESPN), not this league's; sent with "kona_player_info".
public record EspnPlayer(
    int Id,
    string FullName,
    int DefaultPositionId,
    int ProTeamId,
    string? InjuryStatus,
    List<EspnPlayerStat>? Stats,
    EspnOwnership? Ownership);

public record EspnOwnership(double? PercentOwned);

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
