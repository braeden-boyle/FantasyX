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

    /// <summary>
    /// A one-line summary of a game, leaving out stats the player didn't record. Rushing and receiving
    /// yards are combined into scrimmage yards and every touchdown into one count:
    /// "14 CAR, 3 REC, 93 YD, 2 TD" for a back and "5 REC, 84 YD, 1 TD" for a receiver. A QB's passing
    /// yards are kept apart from their rushing yards: "18/27, 245 PASS YD, 3 CAR, 12 RUSH YD, 3 TD, 1 INT".
    /// "FG 2/3, XP 3/3" for a K and "2 SACK, 1 INT, 14 PA" for a D/ST (points allowed always shown).
    /// Null when there's nothing to show, or for a position without columns.
    /// </summary>
    public static string? FormatSummary(string position, IReadOnlyDictionary<string, double> stats)
    {
        IEnumerable<string> parts = position switch
        {
            "QB" =>
            [
                .. Passing(stats), .. QbRushing(stats), .. Touchdowns(stats), .. Counted(stats, 20, "INT"),
                .. Fumbles(stats),
            ],
            "RB" =>
            [
                .. Counted(stats, 23, "CAR"), .. Counted(stats, 53, "REC"), .. ScrimmageYards(stats),
                .. Touchdowns(stats), .. Fumbles(stats),
            ],
            "WR" or "TE" =>
            [
                .. Counted(stats, 53, "REC"), .. Counted(stats, 23, "CAR"), .. ScrimmageYards(stats),
                .. Touchdowns(stats), .. Fumbles(stats),
            ],
            "K" => [.. Kicks(stats, "FG", made: 83, attempted: 84), .. Kicks(stats, "XP", made: 86, attempted: 87)],
            "D/ST" =>
            [
                .. Counted(stats, 99, "SACK"), .. Counted(stats, 95, "INT"), .. Counted(stats, 96, "FR"),
                .. Counted(stats, 94, "TD"), $"{Value(stats, 120)} PA",
            ],
            _ => [],
        };

        var summary = string.Join(", ", parts);
        return summary.Length == 0 ? null : summary;
    }

    private static IEnumerable<string> Passing(IReadOnlyDictionary<string, double> stats) =>
        Raw(stats, 0) == 0 ? [] : [$"{Value(stats, 1)}/{Value(stats, 0)}", $"{Value(stats, 3)} PASS YD"];

    private static IEnumerable<string> QbRushing(IReadOnlyDictionary<string, double> stats) =>
        Raw(stats, 23) == 0 ? [] : [$"{Value(stats, 23)} CAR", $"{Value(stats, 24)} RUSH YD"];

    // Rushing plus receiving yards, shown once the player has a carry or a catch.
    private static IEnumerable<string> ScrimmageYards(IReadOnlyDictionary<string, double> stats) =>
        Raw(stats, 23) == 0 && Raw(stats, 53) == 0 ? [] : [$"{Number(Raw(stats, 24) + Raw(stats, 42))} YD"];

    // Passing, rushing and receiving touchdowns together.
    private static IEnumerable<string> Touchdowns(IReadOnlyDictionary<string, double> stats)
    {
        var touchdowns = Raw(stats, 4) + Raw(stats, 25) + Raw(stats, 43);
        return touchdowns == 0 ? [] : [$"{Number(touchdowns)} TD"];
    }

    private static IEnumerable<string> Fumbles(IReadOnlyDictionary<string, double> stats) => Counted(stats, 72, "FUM");

    private static IEnumerable<string> Kicks(IReadOnlyDictionary<string, double> stats, string label, int made, int attempted) =>
        Raw(stats, attempted) == 0 ? [] : [$"{label} {Value(stats, made)}/{Value(stats, attempted)}"];

    private static IEnumerable<string> Counted(IReadOnlyDictionary<string, double> stats, int statId, string label) =>
        Raw(stats, statId) == 0 ? [] : [$"{Value(stats, statId)} {label}"];

    private static double Raw(IReadOnlyDictionary<string, double> stats, int statId) =>
        stats.GetValueOrDefault(statId.ToString());

    private static Column Single(string label, int statId) => new(label, stats => Value(stats, statId));

    private static Column Ratio(string label, int made, int attempted) =>
        new(label, stats => $"{Value(stats, made)}/{Value(stats, attempted)}");

    // ESPN omits zero-valued stats from the map rather than sending 0.
    private static string Value(IReadOnlyDictionary<string, double> stats, int statId) => Number(Raw(stats, statId));

    private static string Number(double value) => value.ToString("0.#", CultureInfo.InvariantCulture);
}
