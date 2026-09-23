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

    private readonly HttpClient _httpClient;

    public EspnFantasyService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<IReadOnlyList<TeamSummaryDto>> ListTeamsAsync(
        LeagueTeamsRequest request, CancellationToken cancellationToken)
    {
        var league = await FetchLeagueAsync(
            request.LeagueId, request.Season, ["mTeam"], request.EspnS2, request.Swid, cancellationToken);

        return league.Teams?
            .Select(team => new TeamSummaryDto(team.Id, TeamName(team), team.Abbrev ?? string.Empty))
            .ToList() ?? [];
    }

    public async Task<TeamDto> GetTeamRosterAsync(ImportTeamRequest request, CancellationToken cancellationToken)
    {
        var league = await FetchLeagueAsync(
            request.LeagueId,
            request.Season,
            ["mRoster", "mTeam", "mStatus", "mPositionalRatings", "mSettings"],
            request.EspnS2,
            request.Swid,
            cancellationToken);

        var team = league.Teams?.FirstOrDefault(t => t.Id == request.TeamId)
            ?? throw new EspnApiException(
                HttpStatusCode.NotFound, $"Team {request.TeamId} was not found in league {request.LeagueId}.");

        var week = league.Status?.LatestScoringPeriod ?? 1;
        var proSchedule = await FetchProTeamScheduleAsync(request.Season, week, cancellationToken);

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

    private sealed record EspnScheduledGame(int OpponentProTeamId, bool IsHome, long DateMs);

    // This is a separate, game-wide endpoint (not league-scoped), and is best-effort: if ESPN
    // changes its undocumented shape, the roster should still load without opponent/matchup info.
    private async Task<IReadOnlyDictionary<int, EspnScheduledGame>> FetchProTeamScheduleAsync(
        int season, int week, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _httpClient.GetAsync(
                $"seasons/{season}?view=proTeamSchedules_wl", cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                return new Dictionary<int, EspnScheduledGame>();
            }

            var schedules = await response.Content.ReadFromJsonAsync<EspnProTeamSchedulesResponse>(
                EspnJsonOptions, cancellationToken);

            var weekKey = week.ToString();
            var result = new Dictionary<int, EspnScheduledGame>();

            foreach (var team in schedules?.Settings?.ProTeams ?? [])
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
        catch (Exception ex) when (ex is JsonException or NotSupportedException)
        {
            return new Dictionary<int, EspnScheduledGame>();
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

    private async Task<EspnLeagueResponse> FetchLeagueAsync(
        long leagueId,
        int season,
        IEnumerable<string> views,
        string? espnS2,
        string? swid,
        CancellationToken cancellationToken)
    {
        var query = string.Join("&", views.Select(view => $"view={view}"));

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Get, $"seasons/{season}/segments/0/leagues/{leagueId}?{query}");

        if (!string.IsNullOrWhiteSpace(espnS2) && !string.IsNullOrWhiteSpace(swid))
        {
            httpRequest.Headers.Add("Cookie", $"espn_s2={espnS2}; SWID={swid}");
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

        return await response.Content.ReadFromJsonAsync<EspnLeagueResponse>(EspnJsonOptions, cancellationToken)
            ?? throw new EspnApiException(HttpStatusCode.BadGateway, "ESPN returned an empty response.");
    }
}
