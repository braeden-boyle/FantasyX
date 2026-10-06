namespace FantasyX.Backend.Models;

// One ranked player in a snapshot. FantasyTeamId is null for a free agent or waiver player; Status
// is "ROSTERED", "FREEAGENT" or "WAIVERS". WeeklyProjections maps each week of the window to the
// player's projection from the snapshot's source, so a backtest can compare any part of it.
public class PlayerRankingSnapshotEntry
{
    public long SnapshotId { get; set; }
    public int PlayerId { get; set; }
    public string Position { get; set; } = string.Empty;
    public int? FantasyTeamId { get; set; }
    public string Status { get; set; } = string.Empty;
    public int Rank { get; set; }
    public int PositionRank { get; set; }
    public double RestOfSeasonPoints { get; set; }
    public double Value { get; set; }
    public Dictionary<int, double> WeeklyProjections { get; set; } = [];
}
