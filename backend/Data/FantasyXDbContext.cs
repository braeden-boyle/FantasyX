using FantasyX.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace FantasyX.Backend.Data;

public class FantasyXDbContext : DbContext
{
    public FantasyXDbContext(DbContextOptions<FantasyXDbContext> options) : base(options)
    {
    }

    public DbSet<SavedCredentials> SavedCredentials => Set<SavedCredentials>();

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
    }
}
