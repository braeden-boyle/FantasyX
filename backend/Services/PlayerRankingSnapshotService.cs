using FantasyX.Backend.Data;
using FantasyX.Backend.Models;
using FantasyX.Backend.Models.Dtos;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace FantasyX.Backend.Services;

public class PlayerRankingSnapshotService : IPlayerRankingSnapshotService
{
    private readonly FantasyXDbContext _dbContext;

    public PlayerRankingSnapshotService(FantasyXDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    // The first save for a league, season, scoring period and source wins: a later one writes
    // nothing. The snapshot and its entries go in one SaveChanges, so one transaction.
    public async Task<PlayerRankingSnapshotSavedDto> SaveAsync(
        SavePlayerRankingSnapshotRequest request, CancellationToken cancellationToken)
    {
        if (await FindExistingAsync(request, cancellationToken) is long existingId)
        {
            return new PlayerRankingSnapshotSavedDto(existingId, Created: false);
        }

        var snapshot = new PlayerRankingSnapshot
        {
            LeagueId = request.LeagueId,
            Season = request.Season,
            ScoringPeriod = request.ScoringPeriod,
            ProjectionSource = request.ProjectionSource,
            FirstWeek = request.FirstWeek,
            LastWeek = request.LastWeek,
            ReplacementLevels = new Dictionary<string, double>(request.ReplacementLevels),
            CreatedAtUtc = DateTime.UtcNow,
            Entries = request.Entries
                .Select(entry => new PlayerRankingSnapshotEntry
                {
                    PlayerId = entry.PlayerId,
                    Position = entry.Position,
                    FantasyTeamId = entry.FantasyTeamId,
                    Status = entry.Status,
                    Rank = entry.Rank,
                    PositionRank = entry.PositionRank,
                    RestOfSeasonPoints = entry.RestOfSeasonPoints,
                    Value = entry.Value,
                    WeeklyProjections = new Dictionary<int, double>(entry.WeeklyProjections),
                })
                .ToList(),
        };
        _dbContext.PlayerRankingSnapshots.Add(snapshot);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Another save for the same key landed first; it stands.
            _dbContext.ChangeTracker.Clear();
            var winnerId = await FindExistingAsync(request, cancellationToken);
            return new PlayerRankingSnapshotSavedDto(winnerId ?? 0, Created: false);
        }

        return new PlayerRankingSnapshotSavedDto(snapshot.Id, Created: true);
    }

    private Task<long?> FindExistingAsync(SavePlayerRankingSnapshotRequest request, CancellationToken cancellationToken) =>
        _dbContext.PlayerRankingSnapshots
            .Where(s => s.LeagueId == request.LeagueId
                && s.Season == request.Season
                && s.ScoringPeriod == request.ScoringPeriod
                && s.ProjectionSource == request.ProjectionSource)
            .Select(s => (long?)s.Id)
            .FirstOrDefaultAsync(cancellationToken);
}
