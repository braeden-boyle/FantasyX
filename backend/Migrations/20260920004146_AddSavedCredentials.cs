using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FantasyX.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddSavedCredentials : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "saved_credentials",
                columns: table => new
                {
                    device_id = table.Column<Guid>(type: "uuid", nullable: false),
                    encrypted_espn_s2 = table.Column<string>(type: "text", nullable: false),
                    encrypted_swid = table.Column<string>(type: "text", nullable: false),
                    last_league_id = table.Column<long>(type: "bigint", nullable: true),
                    last_season = table.Column<int>(type: "integer", nullable: true),
                    last_team_id = table.Column<int>(type: "integer", nullable: true),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_saved_credentials", x => x.device_id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "saved_credentials");
        }
    }
}
