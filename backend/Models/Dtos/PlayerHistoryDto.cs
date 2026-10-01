namespace FantasyX.Backend.Models.Dtos;

// A player's weekly points against ESPN's projection this season, for every week before the
// requested scoring period that they played while projected above 0. Empty for a player with no
// such weeks. The frontend builds FantasyX projections, spreads and the backtest from this.
// Upcoming is ESPN's projection for the requested scoring period and every later NFL week it has
// projected above 0 (a bye, or a player ruled out, has none), for power rankings and playoff odds.
public record PlayerHistoryDto(
    int PlayerId, IReadOnlyList<PlayerHistoryWeekDto> Weeks, IReadOnlyList<PlayerProjectionWeekDto> Upcoming);

// OpponentPositionRank is the opponent's current rank against the player's position (ESPN only
// exposes today's ranks, not the rank as it stood that week). Null when unknown.
public record PlayerHistoryWeekDto(int Week, double Actual, double Projected, int? OpponentPositionRank);

public record PlayerProjectionWeekDto(int Week, double Projected);
