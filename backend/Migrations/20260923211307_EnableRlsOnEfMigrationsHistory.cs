using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FantasyX.Backend.Migrations
{
    /// <inheritdoc />
    public partial class EnableRlsOnEfMigrationsHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Same reasoning as EnableRlsOnSavedCredentials: EF's own history table lives in public,
            // so Supabase's Data API (PostgREST) exposes it to the anon/authenticated roles unless RLS
            // is on. No policies are added; the backend's connection owns the table and bypasses RLS,
            // so migrations keep reading and writing it.
            migrationBuilder.Sql("ALTER TABLE \"__EFMigrationsHistory\" ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"__EFMigrationsHistory\" DISABLE ROW LEVEL SECURITY;");
        }
    }
}
