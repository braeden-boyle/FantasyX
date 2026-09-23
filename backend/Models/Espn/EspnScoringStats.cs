using FantasyX.Backend.Models.Dtos;

namespace FantasyX.Backend.Models.Espn;

/// <summary>
/// Turns a weekly stat entry's "appliedStats" (stat id -> fantasy points under the league's scoring)
/// into a readable breakdown. Labels cover the scoring stat ids seen in 2026 league data; each was
/// matched against its raw stat value and point total (e.g. 248 passing yards -> 9.92 points,
/// a Steelers D/ST game with 2 INTs and no fumble recoveries scoring 103 as its return TD).
/// Ids not listed here still appear in the breakdown under a generic label.
/// </summary>
public static class EspnScoringStats
{
    private enum Kind
    {
        // Points scale with the stat (yards, catches, TDs), so a per-unit rate is shown.
        PerUnit,

        // A range bonus (e.g. 7-13 points allowed) worth a fixed amount when the game lands in it.
        Bracket,
    }

    private sealed record ScoringStat(string Label, Kind Kind = Kind.PerUnit, int? BracketValueStatId = null);

    private const int PointsAllowedStatId = 120;
    private const int YardsAllowedStatId = 127;

    // Ordered for display: offense, kicking, then defense/special teams.
    private static readonly IReadOnlyList<KeyValuePair<int, ScoringStat>> Stats =
    [
        new(3, new("Passing yards")),
        new(4, new("Passing TD")),
        new(19, new("2-pt conversion (pass)")),
        new(20, new("Interceptions thrown")),
        new(24, new("Rushing yards")),
        new(25, new("Rushing TD")),
        new(26, new("2-pt conversion (rush)")),
        new(53, new("Receptions")),
        new(42, new("Receiving yards")),
        new(43, new("Receiving TD")),
        new(44, new("2-pt conversion (catch)")),
        new(72, new("Fumbles lost")),
        new(80, new("FG made (0-39)")),
        new(77, new("FG made (40-49)")),
        new(198, new("FG made (50-59)")),
        new(201, new("FG made (60+)")),
        new(85, new("FG missed")),
        new(86, new("Extra point made")),
        new(88, new("Extra point missed")),
        new(99, new("Sacks")),
        new(95, new("Interceptions")),
        new(96, new("Fumble recoveries")),
        new(97, new("Blocked kicks")),
        new(98, new("Safeties")),
        new(103, new("Interception return TD")),
        new(104, new("Fumble return TD")),
        new(93, new("Blocked kick return TD")),
        new(101, new("Kickoff return TD")),
        new(102, new("Punt return TD")),
        new(89, new("Points allowed (0)", Kind.Bracket, PointsAllowedStatId)),
        new(90, new("Points allowed (1-6)", Kind.Bracket, PointsAllowedStatId)),
        new(91, new("Points allowed (7-13)", Kind.Bracket, PointsAllowedStatId)),
        new(92, new("Points allowed (14-17)", Kind.Bracket, PointsAllowedStatId)),
        new(121, new("Points allowed (18-21)", Kind.Bracket, PointsAllowedStatId)),
        new(122, new("Points allowed (22-27)", Kind.Bracket, PointsAllowedStatId)),
        new(123, new("Points allowed (28-34)", Kind.Bracket, PointsAllowedStatId)),
        new(124, new("Points allowed (35-45)", Kind.Bracket, PointsAllowedStatId)),
        new(125, new("Points allowed (46+)", Kind.Bracket, PointsAllowedStatId)),
        new(128, new("Yards allowed (0-99)", Kind.Bracket, YardsAllowedStatId)),
        new(129, new("Yards allowed (100-199)", Kind.Bracket, YardsAllowedStatId)),
        new(130, new("Yards allowed (200-299)", Kind.Bracket, YardsAllowedStatId)),
        new(131, new("Yards allowed (300-349)", Kind.Bracket, YardsAllowedStatId)),
        new(132, new("Yards allowed (350-399)", Kind.Bracket, YardsAllowedStatId)),
        new(133, new("Yards allowed (400-449)", Kind.Bracket, YardsAllowedStatId)),
        new(134, new("Yards allowed (450-499)", Kind.Bracket, YardsAllowedStatId)),
        new(135, new("Yards allowed (500-549)", Kind.Bracket, YardsAllowedStatId)),
        new(136, new("Yards allowed (550+)", Kind.Bracket, YardsAllowedStatId)),
    ];

    private static readonly IReadOnlyDictionary<int, int> DisplayOrder =
        Stats.Select((stat, index) => (stat.Key, index)).ToDictionary(pair => pair.Key, pair => pair.index);

    private static readonly IReadOnlyDictionary<int, ScoringStat> StatsById = Stats.ToDictionary();

    // Only stats that actually moved the score are listed; ESPN also sends every bracket the
    // league scores, most of them at 0 points.
    public static IReadOnlyList<ScoringLineDto> Breakdown(
        IReadOnlyDictionary<string, double> appliedStats, IReadOnlyDictionary<string, double>? stats)
    {
        var lines = new List<(int Order, ScoringLineDto Line)>();

        foreach (var (key, points) in appliedStats)
        {
            if (points == 0 || !int.TryParse(key, out var statId))
            {
                continue;
            }

            var stat = StatsById.GetValueOrDefault(statId) ?? new ScoringStat($"Stat {statId}");

            ScoringLineDto line = stat.Kind == Kind.Bracket
                ? new(stat.Label, stats?.GetValueOrDefault(stat.BracketValueStatId!.Value.ToString()), null, points)
                : stats?.GetValueOrDefault(key) is double value and not 0
                    ? new(stat.Label, value, points / value, points)
                    : new(stat.Label, null, null, points);

            lines.Add((DisplayOrder.GetValueOrDefault(statId, int.MaxValue), line));
        }

        return lines.OrderBy(entry => entry.Order).Select(entry => entry.Line).ToList();
    }
}
