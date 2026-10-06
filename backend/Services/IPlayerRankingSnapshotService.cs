using FantasyX.Backend.Models.Dtos;

namespace FantasyX.Backend.Services;

public interface IPlayerRankingSnapshotService
{
    Task<PlayerRankingSnapshotSavedDto> SaveAsync(
        SavePlayerRankingSnapshotRequest request, CancellationToken cancellationToken);
}
