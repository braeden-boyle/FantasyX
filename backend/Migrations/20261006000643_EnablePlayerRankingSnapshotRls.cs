using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FantasyX.Backend.Migrations
{
    /// <inheritdoc />
    public partial class EnablePlayerRankingSnapshotRls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Same reasoning as EnableRlsOnSavedCredentials: both tables live in public, so Supabase's
            // Data API (PostgREST) exposes them to the anon/authenticated roles unless RLS is on. No
            // policies are added; the backend's connection owns the tables and bypasses RLS.
            migrationBuilder.Sql("ALTER TABLE player_ranking_snapshots ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("ALTER TABLE player_ranking_snapshot_entries ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE player_ranking_snapshot_entries DISABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("ALTER TABLE player_ranking_snapshots DISABLE ROW LEVEL SECURITY;");
        }
    }
}
