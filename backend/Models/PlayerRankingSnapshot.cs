namespace FantasyX.Backend.Models;

// A league's player rankings as they stood for one scoring period and projection source ("ESPN" or
// "FANTASYX"), saved weekly by the capture workflow so a later backtest can compare value with what
// players went on to score. FirstWeek-LastWeek is the rest-of-season window the ranking covers, and
// ReplacementLevels each position's replacement level in points over it.
public class PlayerRankingSnapshot
{
    public long Id { get; set; }
    public long LeagueId { get; set; }
    public int Season { get; set; }
    public int ScoringPeriod { get; set; }
    public string ProjectionSource { get; set; } = string.Empty;
    public int FirstWeek { get; set; }
    public int LastWeek { get; set; }
    public Dictionary<string, double> ReplacementLevels { get; set; } = [];
    public DateTime CreatedAtUtc { get; set; }
    public List<PlayerRankingSnapshotEntry> Entries { get; set; } = [];
}
