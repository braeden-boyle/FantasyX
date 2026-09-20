using FantasyX.Backend.Data;
using FantasyX.Backend.Models;
using FantasyX.Backend.Models.Dtos;
using Microsoft.EntityFrameworkCore;

namespace FantasyX.Backend.Services;

public class CredentialsService : ICredentialsService
{
    private readonly FantasyXDbContext _dbContext;
    private readonly CredentialProtector _protector;

    public CredentialsService(FantasyXDbContext dbContext, CredentialProtector protector)
    {
        _dbContext = dbContext;
        _protector = protector;
    }

    public async Task<SavedCredentialsDto?> GetAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.SavedCredentials.FindAsync([deviceId], cancellationToken);
        if (entity is null)
        {
            return null;
        }

        return new SavedCredentialsDto(
            _protector.Unprotect(entity.EncryptedEspnS2),
            _protector.Unprotect(entity.EncryptedSwid),
            entity.LastLeagueId,
            entity.LastSeason,
            entity.LastTeamId);
    }

    public async Task SaveAsync(Guid deviceId, SaveCredentialsRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.SavedCredentials.FindAsync([deviceId], cancellationToken);
        if (entity is null)
        {
            entity = new SavedCredentials { DeviceId = deviceId };
            _dbContext.SavedCredentials.Add(entity);
        }

        entity.EncryptedEspnS2 = _protector.Protect(request.EspnS2);
        entity.EncryptedSwid = _protector.Protect(request.Swid);
        entity.LastLeagueId = request.LastLeagueId;
        entity.LastSeason = request.LastSeason;
        entity.LastTeamId = request.LastTeamId;
        entity.UpdatedAtUtc = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.SavedCredentials.FindAsync([deviceId], cancellationToken);
        if (entity is null)
        {
            return;
        }

        _dbContext.SavedCredentials.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}
