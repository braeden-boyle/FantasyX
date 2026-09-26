using System.ComponentModel.DataAnnotations;

namespace FantasyX.Backend.Models.Dtos;

// Url must be an ESPN-hosted uploaded team logo; anything else is rejected (see EspnFantasyService).
public record TeamLogoRequest(
    [Required] string Url,
    string? EspnS2,
    string? Swid);

public record TeamLogoImage(byte[] Content, string ContentType);
