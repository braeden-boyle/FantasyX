using FantasyX.Backend.Filters;
using FantasyX.Backend.Models.Dtos;
using FantasyX.Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace FantasyX.Backend.Controllers;

// Written to by the weekly capture workflow only (frontend/scripts/capture-player-rankings.ts);
// the app itself never writes or reads snapshots.
[ApiController]
[Route("api/player-ranking-snapshots")]
[RequireCaptureKey]
public class PlayerRankingSnapshotsController : ControllerBase
{
    private readonly IPlayerRankingSnapshotService _snapshotService;

    public PlayerRankingSnapshotsController(IPlayerRankingSnapshotService snapshotService)
    {
        _snapshotService = snapshotService;
    }

    // 201 when the snapshot was written; 200, writing nothing, when one already exists for the key.
    [HttpPost]
    public async Task<ActionResult<PlayerRankingSnapshotSavedDto>> Save(
        SavePlayerRankingSnapshotRequest request, CancellationToken cancellationToken)
    {
        if (request.FirstWeek > request.LastWeek)
        {
            ModelState.AddModelError(nameof(request.LastWeek), "lastWeek can't be before firstWeek.");
        }
        if (request.Entries.DistinctBy(entry => entry.PlayerId).Count() != request.Entries.Count)
        {
            ModelState.AddModelError(nameof(request.Entries), "Each player can only appear once.");
        }
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var saved = await _snapshotService.SaveAsync(request, cancellationToken);
        return saved.Created ? StatusCode(StatusCodes.Status201Created, saved) : Ok(saved);
    }
}
