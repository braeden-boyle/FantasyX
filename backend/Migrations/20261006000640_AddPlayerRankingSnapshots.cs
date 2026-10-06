using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace FantasyX.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerRankingSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "player_ranking_snapshots",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    league_id = table.Column<long>(type: "bigint", nullable: false),
                    season = table.Column<int>(type: "integer", nullable: false),
                    scoring_period = table.Column<int>(type: "integer", nullable: false),
                    projection_source = table.Column<string>(type: "text", nullable: false),
                    first_week = table.Column<int>(type: "integer", nullable: false),
                    last_week = table.Column<int>(type: "integer", nullable: false),
                    replacement_levels = table.Column<string>(type: "jsonb", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_ranking_snapshots", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "player_ranking_snapshot_entries",
                columns: table => new
                {
                    snapshot_id = table.Column<long>(type: "bigint", nullable: false),
                    player_id = table.Column<int>(type: "integer", nullable: false),
                    position = table.Column<string>(type: "text", nullable: false),
                    fantasy_team_id = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "text", nullable: false),
                    rank = table.Column<int>(type: "integer", nullable: false),
                    position_rank = table.Column<int>(type: "integer", nullable: false),
                    rest_of_season_points = table.Column<double>(type: "double precision", nullable: false),
                    value = table.Column<double>(type: "double precision", nullable: false),
                    weekly_projections = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_player_ranking_snapshot_entries", x => new { x.snapshot_id, x.player_id });
                    table.ForeignKey(
                        name: "fk_player_ranking_snapshot_entries_snapshot",
                        column: x => x.snapshot_id,
                        principalTable: "player_ranking_snapshots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_player_ranking_snapshots_key",
                table: "player_ranking_snapshots",
                columns: new[] { "league_id", "season", "scoring_period", "projection_source" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "player_ranking_snapshot_entries");

            migrationBuilder.DropTable(
                name: "player_ranking_snapshots");
        }
    }
}
