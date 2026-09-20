using FantasyX.Backend.Models.Dtos;

namespace FantasyX.Backend.Services;

public interface ICredentialsService
{
    Task<SavedCredentialsDto?> GetAsync(Guid deviceId, CancellationToken cancellationToken);

    Task SaveAsync(Guid deviceId, SaveCredentialsRequest request, CancellationToken cancellationToken);

    Task DeleteAsync(Guid deviceId, CancellationToken cancellationToken);
}
