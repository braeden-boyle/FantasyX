using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FantasyX.Backend.Migrations
{
    /// <inheritdoc />
    public partial class EnableRlsOnSavedCredentials : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // No policies are added on purpose: this table is only ever accessed by the backend's
            // own connection (table owner, bypasses RLS). Enabling RLS with zero policies denies
            // access via Supabase's Data API (PostgREST) for the anon/authenticated roles entirely,
            // which is defense-in-depth against public.saved_credentials being reachable that way.
            migrationBuilder.Sql("ALTER TABLE saved_credentials ENABLE ROW LEVEL SECURITY;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE saved_credentials DISABLE ROW LEVEL SECURITY;");
        }
    }
}
