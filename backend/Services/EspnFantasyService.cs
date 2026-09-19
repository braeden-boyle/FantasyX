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
            request.LeagueId, request.Season, ["mRoster", "mTeam"], request.EspnS2, request.Swid, cancellationToken);

        var team = league.Teams?.FirstOrDefault(t => t.Id == request.TeamId)
            ?? throw new EspnApiException(
                HttpStatusCode.NotFound, $"Team {request.TeamId} was not found in league {request.LeagueId}.");

        var players = team.Roster?.Entries?.Select(ToPlayerDto).ToList() ?? [];
        var overall = team.Record?.Overall;

        return new TeamDto(
            team.Id,
            TeamName(team),
            team.Abbrev ?? string.Empty,
            overall?.Wins ?? 0,
            overall?.Losses ?? 0,
            overall?.Ties ?? 0,
            players);
    }

    private static PlayerDto ToPlayerDto(EspnRosterEntry entry)
    {
        var player = entry.PlayerPoolEntry.Player;
        return new PlayerDto(
            player.Id,
            player.FullName,
            EspnLookups.PositionName(player.DefaultPositionId),
            EspnLookups.ProTeamAbbrev(player.ProTeamId),
            EspnLookups.SlotName(entry.LineupSlotId),
            EspnLookups.IsStarterSlot(entry.LineupSlotId),
            player.InjuryStatus,
            $"https://a.espncdn.com/i/headshots/nfl/players/full/{player.Id}.png");
    }

    private static string TeamName(EspnTeam team)
    {
        var name = $"{team.Location} {team.Nickname}".Trim();
        return string.IsNullOrWhiteSpace(name) ? team.Abbrev ?? "Unknown" : name;
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
