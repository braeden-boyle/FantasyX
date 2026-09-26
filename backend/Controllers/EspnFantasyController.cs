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
