using FantasyX.Backend.Models.Dtos;

namespace FantasyX.Backend.Services;

public interface IEspnFantasyService
{
    Task<IReadOnlyList<TeamSummaryDto>> ListTeamsAsync(LeagueTeamsRequest request, CancellationToken cancellationToken);

    Task<TeamDto> GetTeamRosterAsync(ImportTeamRequest request, CancellationToken cancellationToken);

    Task<PlayerDetailDto> GetPlayerDetailAsync(PlayerDetailRequest request, CancellationToken cancellationToken);
}
