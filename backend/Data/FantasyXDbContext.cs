using System.Text.Json;
using FantasyX.Backend.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace FantasyX.Backend.Data;

public class FantasyXDbContext : DbContext
{
    public FantasyXDbContext(DbContextOptions<FantasyXDbContext> options) : base(options)
    {
    }

    public DbSet<SavedCredentials> SavedCredentials => Set<SavedCredentials>();

    public DbSet<PlayerRankingSnapshot> PlayerRankingSnapshots => Set<PlayerRankingSnapshot>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SavedCredentials>(entity =>
        {
            entity.ToTable("saved_credentials");
            entity.HasKey(e => e.DeviceId);
            entity.Property(e => e.DeviceId).HasColumnName("device_id");
            entity.Property(e => e.EncryptedEspnS2).HasColumnName("encrypted_espn_s2");
            entity.Property(e => e.EncryptedSwid).HasColumnName("encrypted_swid");
            entity.Property(e => e.LastLeagueId).HasColumnName("last_league_id");
            entity.Property(e => e.LastSeason).HasColumnName("last_season");
            entity.Property(e => e.LastTeamId).HasColumnName("last_team_id");
            entity.Property(e => e.UpdatedAtUtc).HasColumnName("updated_at_utc");
        });

        modelBuilder.Entity<PlayerRankingSnapshot>(entity =>
        {
            entity.ToTable("player_ranking_snapshots");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.LeagueId).HasColumnName("league_id");
            entity.Property(e => e.Season).HasColumnName("season");
            entity.Property(e => e.ScoringPeriod).HasColumnName("scoring_period");
            entity.Property(e => e.ProjectionSource).HasColumnName("projection_source");
            entity.Property(e => e.FirstWeek).HasColumnName("first_week");
            entity.Property(e => e.LastWeek).HasColumnName("last_week");
            JsonbColumn(entity.Property(e => e.ReplacementLevels)).HasColumnName("replacement_levels");
            entity.Property(e => e.CreatedAtUtc).HasColumnName("created_at_utc");
            // One snapshot per league, season, scoring period and source: the first save wins.
            entity.HasIndex(e => new { e.LeagueId, e.Season, e.ScoringPeriod, e.ProjectionSource })
                .IsUnique()
                .HasDatabaseName("ix_player_ranking_snapshots_key");
            entity.HasMany(e => e.Entries)
                .WithOne()
                .HasForeignKey(e => e.SnapshotId)
                .HasConstraintName("fk_player_ranking_snapshot_entries_snapshot")
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PlayerRankingSnapshotEntry>(entity =>
        {
            entity.ToTable("player_ranking_snapshot_entries");
            entity.HasKey(e => new { e.SnapshotId, e.PlayerId });
            entity.Property(e => e.SnapshotId).HasColumnName("snapshot_id");
            entity.Property(e => e.PlayerId).HasColumnName("player_id");
            entity.Property(e => e.Position).HasColumnName("position");
            entity.Property(e => e.FantasyTeamId).HasColumnName("fantasy_team_id");
            entity.Property(e => e.Status).HasColumnName("status");
            entity.Property(e => e.Rank).HasColumnName("rank");
            entity.Property(e => e.PositionRank).HasColumnName("position_rank");
            entity.Property(e => e.RestOfSeasonPoints).HasColumnName("rest_of_season_points");
            entity.Property(e => e.Value).HasColumnName("value");
            JsonbColumn(entity.Property(e => e.WeeklyProjections)).HasColumnName("weekly_projections");
        });
    }

    // A dictionary stored as a jsonb object. Converted to and from a JSON string here rather than
    // with Npgsql's POCO mapping, which needs dynamic JSON switched on for the whole data source.
    private static PropertyBuilder<Dictionary<TKey, double>> JsonbColumn<TKey>(
        PropertyBuilder<Dictionary<TKey, double>> property) where TKey : notnull =>
        property
            .HasColumnType("jsonb")
            .HasConversion(
                value => JsonSerializer.Serialize(value, (JsonSerializerOptions?)null),
                json => JsonSerializer.Deserialize<Dictionary<TKey, double>>(json, (JsonSerializerOptions?)null) ?? new(),
                new ValueComparer<Dictionary<TKey, double>>(
                    (a, b) => a!.Count == b!.Count && !a.Except(b).Any(),
                    value => value.Aggregate(0, (hash, entry) => hash ^ HashCode.Combine(entry.Key, entry.Value)),
                    value => new Dictionary<TKey, double>(value)));
}
