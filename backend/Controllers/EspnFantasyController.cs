using FantasyX.Backend.Models.Dtos;
using FantasyX.Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace FantasyX.Backend.Controllers;

[ApiController]
[Route("api/espn")]
public class EspnFantasyController : ControllerBase
{
    private readonly IEspnFantasyService _espnFantasyService;

    public EspnFantasyController(IEspnFantasyService espnFantasyService)
    {
        _espnFantasyService = espnFantasyService;
    }

    [HttpPost("leagues/teams")]
    public async Task<ActionResult<IReadOnlyList<TeamSummaryDto>>> ListTeams(
        LeagueTeamsRequest request, CancellationToken cancellationToken)
    {
        var teams = await _espnFantasyService.ListTeamsAsync(request, cancellationToken);
        return Ok(teams);
    }

    [HttpPost("league")]
    public async Task<ActionResult<LeagueDto>> GetLeague(LeagueTeamsRequest request, CancellationToken cancellationToken)
    {
        var league = await _espnFantasyService.GetLeagueAsync(request, cancellationToken);
        return Ok(league);
    }

    [HttpPost("logo")]
    public async Task<IActionResult> GetTeamLogo(TeamLogoRequest request, CancellationToken cancellationToken)
    {
        var logo = await _espnFantasyService.GetTeamLogoAsync(request, cancellationToken);
        return File(logo.Content, logo.ContentType);
    }

    [HttpPost("team")]
    public async Task<ActionResult<TeamDto>> GetTeam(ImportTeamRequest request, CancellationToken cancellationToken)
    {
        var team = await _espnFantasyService.GetTeamRosterAsync(request, cancellationToken);
        return Ok(team);
    }

    [HttpPost("player")]
    public async Task<ActionResult<PlayerDetailDto>> GetPlayer(
        PlayerDetailRequest request, CancellationToken cancellationToken)
    {
        var player = await _espnFantasyService.GetPlayerDetailAsync(request, cancellationToken);
        return Ok(player);
    }
}
