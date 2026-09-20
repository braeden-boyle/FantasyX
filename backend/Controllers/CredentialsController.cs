using FantasyX.Backend.Models.Dtos;
using FantasyX.Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace FantasyX.Backend.Controllers;

[ApiController]
[Route("api/credentials")]
public class CredentialsController : ControllerBase
{
    private readonly ICredentialsService _credentialsService;

    public CredentialsController(ICredentialsService credentialsService)
    {
        _credentialsService = credentialsService;
    }

    [HttpGet("{deviceId:guid}")]
    public async Task<ActionResult<SavedCredentialsDto>> Get(Guid deviceId, CancellationToken cancellationToken)
    {
        var credentials = await _credentialsService.GetAsync(deviceId, cancellationToken);
        return credentials is null ? NotFound() : Ok(credentials);
    }

    [HttpPut("{deviceId:guid}")]
    public async Task<IActionResult> Save(
        Guid deviceId, [FromBody] SaveCredentialsRequest request, CancellationToken cancellationToken)
    {
        await _credentialsService.SaveAsync(deviceId, request, cancellationToken);
        return NoContent();
    }

    [HttpDelete("{deviceId:guid}")]
    public async Task<IActionResult> Delete(Guid deviceId, CancellationToken cancellationToken)
    {
        await _credentialsService.DeleteAsync(deviceId, cancellationToken);
        return NoContent();
    }
}
