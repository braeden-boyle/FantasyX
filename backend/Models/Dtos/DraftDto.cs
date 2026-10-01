namespace FantasyX.Backend.Models.Dtos;

// The league's draft, for the draft-day power ranking: every pick with the player's week 1
// projection (0 when ESPN has none), plus the starting lineup slots that ranking fills. Picks is
// empty before the draft.
public record DraftDto(IReadOnlyList<DraftPickDto> Picks, IReadOnlyList<LineupSlotDto> LineupSlots);

public record DraftPickDto(int TeamId, int PlayerId, string Position, double Week1Projection);

// A starting slot (bench and IR left out) with how many of it a lineup has and the positions that
// can fill it, e.g. FLEX: RB, WR, TE.
public record LineupSlotDto(string Slot, int Count, IReadOnlyList<string> EligiblePositions);
