using System.Globalization;

namespace FantasyX.Backend.Models.Espn;

/// <summary>
/// Per-position game log columns, built from ESPN's raw stat ids (the "stats" map on a per-game stat
/// entry). Like <see cref="EspnLookups"/>, the ids come from community reverse-engineering; the
/// offensive and kicking ids plus D/ST sacks/INT/points/yards allowed were spot-checked against real
/// 2026 box scores, while D/ST fumble recoveries (96) and touchdowns (94) were not.
/// </summary>
public static class EspnStatColumns
{
    private sealed record Column(string Label, Func<IReadOnlyDictionary<string, double>, string> Format);

    private static readonly Column PassCompletionsAttempts = Ratio("C/ATT", made: 1, attempted: 0);
    private static readonly Column PassYards = Single("PASS YDS", 3);
    private static readonly Column PassTouchdowns = Single("PASS TD", 4);
    private static readonly Column Interceptions = Single("INT", 20);
    private static readonly Column Carries = Single("CAR", 23);
    private static readonly Column RushYards = Single("RUSH YDS", 24);
    private static readonly Column RushTouchdowns = Single("RUSH TD", 25);
    private static readonly Column ReceptionsTargets = Ratio("REC/TGT", made: 53, attempted: 58);
    private static readonly Column ReceivingYards = Single("REC YDS", 42);
    private static readonly Column ReceivingTouchdowns = Single("REC TD", 43);
    private static readonly Column FumblesLost = Single("FUM", 72);

    private static readonly IReadOnlyDictionary<string, Column[]> ColumnsByPosition = new Dictionary<string, Column[]>
    {
        ["QB"] =
        [
            PassCompletionsAttempts, PassYards, PassTouchdowns, Interceptions, RushYards, RushTouchdowns, FumblesLost,
        ],
        ["RB"] =
        [
            Carries, RushYards, RushTouchdowns, ReceptionsTargets, ReceivingYards, ReceivingTouchdowns, FumblesLost,
        ],
        ["WR"] = [ReceptionsTargets, ReceivingYards, ReceivingTouchdowns, RushYards, FumblesLost],
        ["TE"] = [ReceptionsTargets, ReceivingYards, ReceivingTouchdowns, RushYards, FumblesLost],
        // ESPN has no longest-field-goal stat, so 50+ yard makes stand in for it.
        ["K"] = [Ratio("FG", made: 83, attempted: 84), Ratio("50+", made: 74, attempted: 75), Ratio("XP", made: 86, attempted: 87)],
        ["D/ST"] =
        [
            Single("SACK", 99), Single("INT", 95), Single("FR", 96), Single("TD", 94), Single("PA", 120), Single("YA", 127),
        ],
    };

    public static IReadOnlyList<string> LabelsFor(string position) =>
        ColumnsByPosition.TryGetValue(position, out var columns) ? columns.Select(c => c.Label).ToList() : [];

    public static IReadOnlyList<string> FormatStatLine(string position, IReadOnlyDictionary<string, double> stats) =>
        ColumnsByPosition.TryGetValue(position, out var columns) ? columns.Select(c => c.Format(stats)).ToList() : [];

    private static Column Single(string label, int statId) => new(label, stats => Value(stats, statId));

    private static Column Ratio(string label, int made, int attempted) =>
        new(label, stats => $"{Value(stats, made)}/{Value(stats, attempted)}");

    // ESPN omits zero-valued stats from the map rather than sending 0.
    private static string Value(IReadOnlyDictionary<string, double> stats, int statId) =>
        stats.GetValueOrDefault(statId.ToString()).ToString("0.#", CultureInfo.InvariantCulture);
}
