namespace FantasyX.Backend.Models;

public class SavedCredentials
{
    public Guid DeviceId { get; set; }
    public string EncryptedEspnS2 { get; set; } = string.Empty;
    public string EncryptedSwid { get; set; } = string.Empty;
    public long? LastLeagueId { get; set; }
    public int? LastSeason { get; set; }
    public int? LastTeamId { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
