namespace FantasyX.Backend.Models.Espn;

// ESPN's fantasy API returns far more fields than these; only what we use is modeled here.
public record EspnLeagueResponse(List<EspnTeam>? Teams);

public record EspnTeam(int Id, string? Abbrev, string? Location, string? Nickname, EspnRecord? Record, EspnRoster? Roster);

public record EspnRecord(EspnOverallRecord? Overall);

public record EspnOverallRecord(int Wins, int Losses, int Ties);

public record EspnRoster(List<EspnRosterEntry>? Entries);

public record EspnRosterEntry(int PlayerId, int LineupSlotId, EspnPlayerPoolEntry PlayerPoolEntry);

public record EspnPlayerPoolEntry(EspnPlayer Player);

public record EspnPlayer(int Id, string FullName, int DefaultPositionId, int ProTeamId, string? InjuryStatus);
