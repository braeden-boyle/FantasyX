namespace FantasyX.Backend.Models.Espn;

/// <summary>
/// ESPN's fantasy API is undocumented and returns positions/pro teams/roster slots as internal
/// integer codes rather than names. These tables come from community reverse-engineering of that
/// API and should be spot-checked against a real league response if ESPN changes them.
/// </summary>
public static class EspnLookups
{
    private static readonly IReadOnlyDictionary<int, string> Positions = new Dictionary<int, string>
    {
        [1] = "QB",
        [2] = "RB",
        [3] = "WR",
        [4] = "TE",
        [5] = "K",
        [16] = "D/ST",
    };

    private static readonly IReadOnlyDictionary<int, string> ProTeams = new Dictionary<int, string>
    {
        [0] = "FA", [1] = "ATL", [2] = "BUF", [3] = "CHI", [4] = "CIN", [5] = "CLE",
        [6] = "DAL", [7] = "DEN", [8] = "DET", [9] = "GB", [10] = "TEN", [11] = "IND",
        [12] = "KC", [13] = "LV", [14] = "LAR", [15] = "MIA", [16] = "MIN", [17] = "NE",
        [18] = "NO", [19] = "NYG", [20] = "NYJ", [21] = "PHI", [22] = "ARI", [23] = "PIT",
        [24] = "LAC", [25] = "SF", [26] = "SEA", [27] = "TB", [28] = "WSH", [29] = "CAR",
        [30] = "JAX", [33] = "BAL", [34] = "HOU",
    };

    private static readonly IReadOnlyDictionary<int, string> LineupSlots = new Dictionary<int, string>
    {
        [0] = "QB",
        [2] = "RB",
        [4] = "WR",
        [6] = "TE",
        [16] = "D/ST",
        [17] = "K",
        [20] = "BE",
        [21] = "IR",
        [23] = "FLEX",
    };

    private static readonly HashSet<int> BenchSlots = [20, 21];

    public static string PositionName(int defaultPositionId) =>
        Positions.GetValueOrDefault(defaultPositionId, $"POS_{defaultPositionId}");

    public static string ProTeamAbbrev(int proTeamId) =>
        ProTeams.GetValueOrDefault(proTeamId, $"TEAM_{proTeamId}");

    public static string SlotName(int lineupSlotId) =>
        LineupSlots.GetValueOrDefault(lineupSlotId, $"SLOT_{lineupSlotId}");

    public static bool IsStarterSlot(int lineupSlotId) => !BenchSlots.Contains(lineupSlotId);
}
