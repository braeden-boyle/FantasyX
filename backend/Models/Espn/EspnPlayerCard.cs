namespace FantasyX.Backend.Models.Espn;

// League-scoped "kona_playercard" view, requested together with "mStatus" and "mPositionalRatings".
public record EspnPlayerCardResponse(
    List<EspnPlayerCard>? Players,
    EspnStatus? Status,
    EspnPositionAgainstOpponent? PositionAgainstOpponent);

// Ratings are keyed by scoring period as a string; "0" is the season to date.
public record EspnPlayerCard(EspnPlayer Player, Dictionary<string, EspnPlayerRating>? Ratings);

public record EspnPlayerRating(int? PositionalRanking);

// League-scoped "kona_player_info" view (the player pool behind ESPN's free-agent list), requested
// together with "mPositionalRatings".
public record EspnPlayerInfoResponse(
    List<EspnPlayerPoolEntryInfo>? Players,
    EspnPositionAgainstOpponent? PositionAgainstOpponent);

// Status is "FREEAGENT", "WAIVERS" or "ONTEAM".
public record EspnPlayerPoolEntryInfo(string? Status, EspnPlayer Player);
