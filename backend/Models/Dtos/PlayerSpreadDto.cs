namespace FantasyX.Backend.Models.Dtos;

// How far a player's weekly points have landed from ESPN's projection this season:
// MeanSquaredError is the mean of (actual - projected)^2 over GamesUsed weeks before the current
// one. GamesUsed is 0 (and MeanSquaredError 0) for a player with no such weeks.
public record PlayerSpreadDto(int PlayerId, int GamesUsed, double MeanSquaredError);
