using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FantasyX.Backend.Exceptions;
using FantasyX.Backend.Models.Dtos;
using FantasyX.Backend.Models.Espn;

namespace FantasyX.Backend.Services;

public class EspnFantasyService : IEspnFantasyService
{
    private static readonly JsonSerializerOptions EspnJsonOptions = new() { PropertyNameCaseInsensitive = true };

    private const int RegularSeasonWeeks = 18;

    private readonly HttpClient _httpClient;

    public EspnFantasyService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<IReadOnlyList<TeamSummaryDto>> ListTeamsAsync(
        LeagueTeamsRequest request, CancellationToken cancellationToken)
    {
        var league = await FetchLeagueAsync<EspnLeagueResponse>(
            request.LeagueId, request.Season, ["mTeam"], request.EspnS2, request.Swid, null, cancellationToken);

        return league.Teams?
            .Select(team => new TeamSummaryDto(team.Id, TeamName(team), team.Abbrev ?? string.Empty))
            .ToList() ?? [];
    }

    public async Task<LeagueDto> GetLeagueAsync(LeagueTeamsRequest request, CancellationToken cancellationToken)
    {
        var league = await FetchLeagueAsync<EspnLeagueResponse>(
            request.LeagueId,
            request.Season,
            ["mTeam", "mStandings", "mSettings", "mStatus", "mMatchupScore", "mScoreboard"],
            request.EspnS2,
            request.Swid,
            null,
            cancellationToken);

        var membersById = league.Members?
            .Where(member => member.Id is not null)
            .DistinctBy(member => member.Id)
            .ToDictionary(member => member.Id!, MemberName) ?? [];

        var standings = league.Teams?
            .Select(team => ToStandingDto(team, membersById))
            .OrderBy(standing => standing.Seed == 0 ? int.MaxValue : standing.Seed)
            .ThenBy(standing => standing.TeamId)
            .ToList() ?? [];

        var period = league.Status?.CurrentMatchupPeriod ?? 0;

        // Byes (no away side) are left out, since there's nothing to show for them.
        var matchups = league.Schedule?
            .Where(entry => entry.MatchupPeriodId == period && entry.Home is not null && entry.Away is not null)
            .Select(entry => new MatchupDto(ToMatchupSideDto(entry.Home!), ToMatchupSideDto(entry.Away!)))
            .ToList() ?? [];

        return new LeagueDto(league.Settings?.Name ?? string.Empty, period, standings, matchups);
    }

    // Logos a manager uploaded (rather than picked from ESPN's presets) are served from this host,
    // which 401s without the league's cookies, so the browser can't load them directly.
    private const string UploadedLogoHost = "mystique-api.fantasy.espn.com";
    private const string UploadedLogoPathPrefix = "/apis/v1/domains/lm/images/";
    private const int MaxLogoBytes = 2 * 1024 * 1024;

    public async Task<TeamLogoImage> GetTeamLogoAsync(TeamLogoRequest request, CancellationToken cancellationToken)
    {
        // Only ever fetch ESPN's uploaded-logo URLs, so this can't be used as an open proxy.
        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var url)
            || url.Scheme != Uri.UriSchemeHttps
            || !url.Host.Equals(UploadedLogoHost, StringComparison.OrdinalIgnoreCase)
            || !url.AbsolutePath.StartsWith(UploadedLogoPathPrefix, StringComparison.Ordinal))
        {
            throw new EspnApiException(HttpStatusCode.BadRequest, "Only ESPN-hosted team logos can be loaded.");
        }

        using var httpRequest = new HttpRequestMessage(HttpMethod.Get, url);
        // This host's edge rejects requests with no User-Agent (a bare nginx 403), unlike the league API.
        httpRequest.Headers.UserAgent.ParseAdd("FantasyX/1.0");
        if (!string.IsNullOrWhiteSpace(request.EspnS2) && !string.IsNullOrWhiteSpace(request.Swid))
        {
            httpRequest.Headers.Add("Cookie", $"espn_s2={request.EspnS2}; SWID={request.Swid}");
        }

        using var response = await _httpClient.SendAsync(
            httpRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

        var contentType = response.Content.Headers.ContentType?.MediaType;
        if (!response.IsSuccessStatusCode || contentType is null || !contentType.StartsWith("image/"))
        {            throw new EspnApiException(HttpStatusCode.NotFound, "That team logo could not be loaded.");
        }
        if (response.Content.Headers.ContentLength > MaxLogoBytes)
        {
            throw new EspnApiException(HttpStatusCode.BadGateway, "That team logo is too large.");
        }

        var content = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        return new TeamLogoImage(content, contentType);
    }

    private static StandingDto ToStandingDto(EspnTeam team, IReadOnlyDictionary<string, string> membersById)
    {
        var overall = team.Record?.Overall;
        var owners = team.Owners?
            .Select(ownerId => membersById.GetValueOrDefault(ownerId))
            .OfType<string>()
            .ToList() ?? [];

        return new StandingDto(
            team.Id,
            team.PlayoffSeed ?? 0,
            TeamName(team),
            team.Abbrev ?? string.Empty,
            string.IsNullOrWhiteSpace(team.Logo) ? null : team.Logo,
            owners,
            overall?.Wins ?? 0,
            overall?.Losses ?? 0,
            overall?.Ties ?? 0,
            overall?.PointsFor ?? 0,
            overall?.PointsAgainst ?? 0,
            StreakLabel(overall));
    }

    private static string? StreakLabel(EspnOverallRecord? overall)
    {
        var prefix = overall?.StreakType switch
        {
            "WIN" => "W",
            "LOSS" => "L",
            "TIE" => "T",
            _ => null,
        };
        return prefix is null || overall?.StreakLength is not > 0 ? null : $"{prefix}{overall.StreakLength}";
    }

    private static MatchupSideDto ToMatchupSideDto(EspnMatchupSide side) =>
        new(side.TeamId, side.TotalPointsLive ?? side.TotalPoints ?? 0, side.TotalProjectedPointsLive);

    private static string MemberName(EspnMember member)
    {
        var fullName = $"{member.FirstName} {member.LastName}".Trim();
        return string.IsNullOrWhiteSpace(fullName) ? member.DisplayName ?? "Unknown" : fullName;
    }

    public async Task<TeamDto> GetTeamRosterAsync(ImportTeamRequest request, CancellationToken cancellationToken)
    {
        var league = await FetchLeagueAsync<EspnLeagueResponse>(
            request.LeagueId,
            request.Season,
            ["mRoster", "mTeam", "mStatus", "mPositionalRatings", "mSettings"],
            request.EspnS2,
            request.Swid,
            null,
            cancellationToken);

        var team = league.Teams?.FirstOrDefault(t => t.Id == request.TeamId)
            ?? throw new EspnApiException(
                HttpStatusCode.NotFound, $"Team {request.TeamId} was not found in league {request.LeagueId}.");

        var week = league.Status?.LatestScoringPeriod ?? 1;
        var proSchedule = ScheduleForWeek(await FetchProTeamSchedulesAsync(request.Season, cancellationToken), week);

        var players = team.Roster?.Entries?
            .Select(entry => ToPlayerDto(entry, week, proSchedule, league.PositionAgainstOpponent))
            .ToList() ?? [];
        var overall = team.Record?.Overall;

        return new TeamDto(
            team.Id,
            TeamName(team),
            team.Abbrev ?? string.Empty,
            league.Settings?.Name ?? string.Empty,
            overall?.Wins ?? 0,
            overall?.Losses ?? 0,
            overall?.Ties ?? 0,
            team.PlayoffSeed ?? 0,
            league.Teams?.Count ?? 0,
            players);
    }

    private static PlayerDto ToPlayerDto(
        EspnRosterEntry entry,
        int week,
        IReadOnlyDictionary<int, EspnScheduledGame> proSchedule,
        EspnPositionAgainstOpponent? positionalRatings)
    {
        var player = entry.PlayerPoolEntry.Player;
        var game = proSchedule.GetValueOrDefault(player.ProTeamId);
        var isTeamDefense = EspnLookups.IsDefenseSpecialTeams(player.DefaultPositionId);

        return new PlayerDto(
            player.Id,
            isTeamDefense ? EspnLookups.TeamDefenseName(player.FullName) : player.FullName,
            EspnLookups.PositionName(player.DefaultPositionId),
            EspnLookups.ProTeamAbbrev(player.ProTeamId),
            EspnLookups.SlotName(entry.LineupSlotId),
            EspnLookups.IsStarterSlot(entry.LineupSlotId),
            player.InjuryStatus,
            isTeamDefense
                ? EspnLookups.TeamLogoUrl(player.ProTeamId)
                : EspnLookups.HeadshotUrl(player.Id),
            isTeamDefense,
            ProjectedPointsFor(player, week),
            ActualPointsFor(player, week),
            game is null ? null : EspnLookups.ProTeamAbbrev(game.OpponentProTeamId),
            game?.IsHome,
            game is null ? null : DateTimeOffset.FromUnixTimeMilliseconds(game.DateMs),
            game is null ? null : PositionRankFor(positionalRatings, player.DefaultPositionId, game.OpponentProTeamId));
    }

    private static double ProjectedPointsFor(EspnPlayer player, int week) =>
        player.Stats?
            .FirstOrDefault(stat => stat.ScoringPeriodId == week && stat.StatSourceId == 1)?
            .AppliedTotal ?? 0;

    private static double ActualPointsFor(EspnPlayer player, int week) =>
        player.Stats?
            .FirstOrDefault(stat => stat.ScoringPeriodId == week && stat.StatSourceId == 0)?
            .AppliedTotal ?? 0;

    private static int? PositionRankFor(
        EspnPositionAgainstOpponent? positionalRatings, int defaultPositionId, int opponentProTeamId)
    {
        if (positionalRatings?.PositionalRatings is null)
        {
            return null;
        }

        if (!positionalRatings.PositionalRatings.TryGetValue(defaultPositionId.ToString(), out var rating))
        {
            return null;
        }

        return rating.RatingsByOpponent?.GetValueOrDefault(opponentProTeamId.ToString())?.Rank;
    }

    public async Task<PlayerDetailDto> GetPlayerDetailAsync(
        PlayerDetailRequest request, CancellationToken cancellationToken)
    {
        // For a real league, ESPN only returns per-week stats when the weeks are listed explicitly
        // (source/split-type filters alone yield just season totals plus the current week). Listing
        // weeks returns actuals and projections for each, but no season-total entries, so totals are
        // summed from the weeks below. SeasonId is still checked in case other seasons slip through.
        var fantasyFilter = JsonSerializer.Serialize(new
        {
            players = new
            {
                filterIds = new { value = new[] { request.PlayerId } },
                filterStatsForScoringPeriodIds = new { value = Enumerable.Range(1, RegularSeasonWeeks).ToArray() },
            },
        });

        var cardTask = FetchLeagueAsync<EspnPlayerCardResponse>(
            request.LeagueId,
            request.Season,
            ["kona_playercard", "mStatus", "mPositionalRatings"],
            request.EspnS2,
            request.Swid,
            fantasyFilter,
            cancellationToken);
        var schedulesTask = FetchProTeamSchedulesAsync(request.Season, cancellationToken);
        await Task.WhenAll(cardTask, schedulesTask);

        var response = await cardTask;
        var schedules = await schedulesTask;

        var card = response.Players?.FirstOrDefault(p => p.Player.Id == request.PlayerId)
            ?? throw new EspnApiException(
                HttpStatusCode.NotFound, $"Player {request.PlayerId} was not found in league {request.LeagueId}.");

        var player = card.Player;
        var position = EspnLookups.PositionName(player.DefaultPositionId);
        var isTeamDefense = EspnLookups.IsDefenseSpecialTeams(player.DefaultPositionId);

        var seasonStats = player.Stats?.Where(stat => stat.SeasonId == request.Season).ToList() ?? [];
        var weeklyActuals = WeeklyStats(seasonStats, statSourceId: 0);
        var weeklyProjections = WeeklyStats(seasonStats, statSourceId: 1);

        var teamSchedule = schedules.FirstOrDefault(team => team.Id == player.ProTeamId);

        // If the league doesn't report its current week, fall back to the player's team's first
        // game that isn't final yet.
        var currentWeek = response.Status?.LatestScoringPeriod is int latestWeek and > 0
            ? latestWeek
            : teamSchedule?.ProGamesByScoringPeriod?
                .Where(entry => entry.Value is [{ StatsOfficial: not true }, ..])
                .Select(entry => int.Parse(entry.Key))
                .DefaultIfEmpty(1)
                .Min() ?? 1;
        var gamesById = schedules
            .SelectMany(team => team.ProGamesByScoringPeriod?.Values.SelectMany(games => games) ?? [])
            .DistinctBy(game => game.Id)
            .ToDictionary(game => game.Id);

        var weeks = (teamSchedule?.ProGamesByScoringPeriod?.Keys.Select(int.Parse) ?? [])
            .Concat(teamSchedule?.ByeWeek is int byeWeek ? [byeWeek] : [])
            .Concat(weeklyActuals.Keys)
            .Concat(weeklyProjections.Keys)
            .Distinct()
            .Order();

        var games = weeks
            .Select(week => ToPlayerGameDto(
                week,
                player,
                currentWeek,
                weeklyActuals.GetValueOrDefault(week),
                weeklyProjections.GetValueOrDefault(week),
                teamSchedule,
                gamesById,
                position,
                response.PositionAgainstOpponent))
            .ToList();

        var totalPoints = weeklyActuals.Values.Sum(stat => stat.AppliedTotal ?? 0);
        var gamesPlayed = weeklyActuals.Count;
        var positionRank = card.Ratings?.GetValueOrDefault("0")?.PositionalRanking;

        var summary = new PlayerSeasonSummaryDto(
            totalPoints,
            gamesPlayed == 0 ? 0 : totalPoints / gamesPlayed,
            gamesPlayed,
            positionRank is > 0 ? positionRank : null,
            weeklyProjections.Values.Sum(stat => stat.AppliedTotal ?? 0),
            games
                .Where(game => game.Week >= currentWeek && game.Status != PlayerGameStatus.Bye)
                .Sum(game => game.ProjectedPoints ?? 0));

        return new PlayerDetailDto(
            player.Id,
            isTeamDefense ? EspnLookups.TeamDefenseName(player.FullName) : player.FullName,
            position,
            EspnLookups.ProTeamAbbrev(player.ProTeamId),
            player.InjuryStatus,
            isTeamDefense ? EspnLookups.TeamLogoUrl(player.ProTeamId) : EspnLookups.HeadshotUrl(player.Id),
            isTeamDefense,
            currentWeek,
            summary,
            EspnStatColumns.LabelsFor(position),
            games);
    }

    private static PlayerGameDto ToPlayerGameDto(
        int week,
        EspnPlayer player,
        int currentWeek,
        EspnPlayerStat? actual,
        EspnPlayerStat? projection,
        EspnProTeamScheduleEntry? teamSchedule,
        IReadOnlyDictionary<long, EspnProGame> gamesById,
        string position,
        EspnPositionAgainstOpponent? positionalRatings)
    {
        // A played week is matched to its game by id rather than by the player's current team's
        // schedule, so weeks played for a previous team still show the right opponent.
        EspnProGame? game = null;
        var teamId = player.ProTeamId;

        if (long.TryParse(actual?.ExternalId, out var gameId) && gamesById.TryGetValue(gameId, out var playedGame))
        {
            game = playedGame;
            teamId = actual!.ProTeamId ?? teamId;
        }
        else if (teamSchedule?.ProGamesByScoringPeriod?.GetValueOrDefault(week.ToString()) is [var scheduledGame, ..])
        {
            game = scheduledGame;
        }

        if (game is null && actual is null && week == teamSchedule?.ByeWeek)
        {
            return new PlayerGameDto(week, PlayerGameStatus.Bye, null, null, null, null, null, null, null, null);
        }

        var isHome = game is null ? (bool?)null : teamId == game.HomeProTeamId;
        var opponentId = game is null ? (int?)null : isHome == true ? game.AwayProTeamId : game.HomeProTeamId;
        var isFinal = game?.StatsOfficial == true || week < currentWeek;

        var status = actual is not null ? PlayerGameStatus.Played
            : isFinal ? PlayerGameStatus.DidNotPlay
            : PlayerGameStatus.Upcoming;

        return new PlayerGameDto(
            week,
            status,
            opponentId is int opponent ? EspnLookups.ProTeamAbbrev(opponent) : null,
            isHome,
            game is null ? null : DateTimeOffset.FromUnixTimeMilliseconds(game.Date),
            opponentId is int rankedOpponent
                ? PositionRankFor(positionalRatings, player.DefaultPositionId, rankedOpponent)
                : null,
            projection?.AppliedTotal,
            status switch
            {
                PlayerGameStatus.Played => actual!.AppliedTotal ?? 0,
                PlayerGameStatus.DidNotPlay => 0,
                _ => null,
            },
            actual?.Stats is { } stats ? EspnStatColumns.FormatStatLine(position, stats) : null,
            actual?.AppliedStats is { } appliedStats ? EspnScoringStats.Breakdown(appliedStats, actual.Stats) : null);
    }

    private static Dictionary<int, EspnPlayerStat> WeeklyStats(IEnumerable<EspnPlayerStat> seasonStats, int statSourceId) =>
        seasonStats
            .Where(stat => stat.StatSourceId == statSourceId && stat.StatSplitTypeId == 1 && stat.ScoringPeriodId > 0)
            .GroupBy(stat => stat.ScoringPeriodId!.Value)
            .ToDictionary(group => group.Key, group => group.First());

    private sealed record EspnScheduledGame(int OpponentProTeamId, bool IsHome, long DateMs);

    private static IReadOnlyDictionary<int, EspnScheduledGame> ScheduleForWeek(
        IReadOnlyList<EspnProTeamScheduleEntry> schedules, int week)
    {
        var weekKey = week.ToString();
        var result = new Dictionary<int, EspnScheduledGame>();

        foreach (var team in schedules)
        {
            if (team.Id == 0
                || team.ProGamesByScoringPeriod is null
                || !team.ProGamesByScoringPeriod.TryGetValue(weekKey, out var games)
                || games is not [var game, ..])
            {
                continue;
            }

            var isHome = team.Id == game.HomeProTeamId;
            var opponentId = isHome ? game.AwayProTeamId : game.HomeProTeamId;
            result[team.Id] = new EspnScheduledGame(opponentId, isHome, game.Date);
        }

        return result;
    }

    // This is a separate, game-wide endpoint (not league-scoped), and is best-effort: if ESPN
    // changes its undocumented shape, callers should still load without opponent/matchup info.
    private async Task<IReadOnlyList<EspnProTeamScheduleEntry>> FetchProTeamSchedulesAsync(
        int season, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _httpClient.GetAsync(
                $"seasons/{season}?view=proTeamSchedules_wl", cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                return [];
            }

            var schedules = await response.Content.ReadFromJsonAsync<EspnProTeamSchedulesResponse>(
                EspnJsonOptions, cancellationToken);

            return schedules?.Settings?.ProTeams ?? [];
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException)
        {
            return [];
        }
    }


    private static string TeamName(EspnTeam team)
    {
        if (!string.IsNullOrWhiteSpace(team.Name))
        {
            return team.Name;
        }

        var legacyName = $"{team.Location} {team.Nickname}".Trim();
        return string.IsNullOrWhiteSpace(legacyName) ? team.Abbrev ?? "Unknown" : legacyName;
    }

    // fantasyFilter is ESPN's "x-fantasy-filter" header: JSON that narrows player-pool views
    // (e.g. kona_playercard) to specific players and stat splits.
    private async Task<T> FetchLeagueAsync<T>(
        long leagueId,
        int season,
        IEnumerable<string> views,
        string? espnS2,
        string? swid,
        string? fantasyFilter,
        CancellationToken cancellationToken)
    {
        var query = string.Join("&", views.Select(view => $"view={view}"));

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Get, $"seasons/{season}/segments/0/leagues/{leagueId}?{query}");

        if (!string.IsNullOrWhiteSpace(espnS2) && !string.IsNullOrWhiteSpace(swid))
        {
            httpRequest.Headers.Add("Cookie", $"espn_s2={espnS2}; SWID={swid}");
        }

        if (fantasyFilter is not null)
        {
            httpRequest.Headers.Add("x-fantasy-filter", fantasyFilter);
        }

        using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw response.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => new EspnApiException(
                    HttpStatusCode.Unauthorized,
                    $"League {leagueId} could not be read. If this is a private league, double-check your espn_s2 and SWID cookie values."),
                HttpStatusCode.NotFound => new EspnApiException(
                    HttpStatusCode.NotFound, $"League {leagueId} was not found for the given season."),
                var status when (int)status is >= 300 and < 400 => new EspnApiException(
                    HttpStatusCode.NotFound,
                    $"League {leagueId} was not found for the given season (ESPN redirected the request)."),
                _ => new EspnApiException(
                    HttpStatusCode.BadGateway, $"ESPN API returned an unexpected error ({(int)response.StatusCode})."),
            };
        }

        return await response.Content.ReadFromJsonAsync<T>(EspnJsonOptions, cancellationToken)
            ?? throw new EspnApiException(HttpStatusCode.BadGateway, "ESPN returned an empty response.");
    }
}
