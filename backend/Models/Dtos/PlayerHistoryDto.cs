namespace FantasyX.Backend.Models.Dtos;

// A player's weekly points against ESPN's projection this season, for every week before the
// requested scoring period that they played while projected above 0. Empty for a player with no
// such weeks. The frontend builds FantasyX projections, spreads and the backtest from this.
public record PlayerHistoryDto(int PlayerId, IReadOnlyList<PlayerHistoryWeekDto> Weeks);

// OpponentPositionRank is the opponent's current rank against the player's position (ESPN only
// exposes today's ranks, not the rank as it stood that week). Null when unknown.
public record PlayerHistoryWeekDto(int Week, double Actual, double Projected, int? OpponentPositionRank);
