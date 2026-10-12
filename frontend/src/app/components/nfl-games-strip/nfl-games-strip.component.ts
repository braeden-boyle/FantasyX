import { Component, ElementRef, effect, input, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NflTeamMarkComponent } from '../nfl-team-mark/nfl-team-mark.component';
import { NflGame, NflGameTeam, Player } from '../../models/team.model';
import { formatGameTime } from '../../utils/player-format';
import { NflGamePhase, nflGamePhase, playersInGame, stripFocusIndex, teamFieldState, winner } from '../../utils/nfl-games';

// One side of the fantasy matchup being viewed, for counting its starters in each NFL game.
export interface StripSide {
  abbrev: string;
  starters: Player[];
}

// The NFL week's games as a horizontally scrolling ticker, like the top of ESPN's site. Each card
// opens the game's page. With the matchup's two sides given, each card also counts how many of
// either side's starters play in it, and games neither side has anyone in are dimmed.
@Component({
  selector: 'app-nfl-games-strip',
  standalone: true,
  imports: [RouterLink, NflTeamMarkComponent],
  templateUrl: './nfl-games-strip.component.html',
  styleUrl: './nfl-games-strip.component.css',
})
export class NflGamesStripComponent {
  readonly games = input.required<NflGame[]>();
  readonly teamsOnBye = input<string[]>([]);
  // Empty, or the matchup's two sides (left, then right).
  readonly sides = input<StripSide[]>([]);
  // The game whose page is open, if any.
  readonly currentGameId = input<string | null>(null);
  // The fantasy team whose matchup the game page goes back to, when it isn't the user's own.
  readonly linkTeam = input<number | null>(null);
  // When the games were fetched, so live games are judged against that moment.
  readonly asOf = input.required<Date>();

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  private scrolledFor: string | null = null;

  constructor() {
    // Open on the current game, or on the first live (else next) game. Only when that target
    // changes, so a refresh never yanks the strip away from where the user scrolled it.
    effect(() => {
      const track = this.track()?.nativeElement;
      const games = this.games();
      const current = this.currentGameId();
      if (!track || !games.length) return;
      const key = current ?? '';
      if (key === this.scrolledFor) return;
      const smooth = this.scrolledFor !== null;
      this.scrolledFor = key;
      const index = current
        ? games.findIndex((g) => g.eventId === current)
        : stripFocusIndex(games, untracked(this.asOf));
      setTimeout(() => {
        const card = track.children[index] as HTMLElement | undefined;
        if (!card) return;
        track.scrollTo({
          left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2,
          behavior: smooth ? 'smooth' : 'auto',
        });
      });
    });
  }

  protected phase(game: NflGame): NflGamePhase {
    return nflGamePhase(game, this.asOf());
  }

  protected fieldState(game: NflGame, team: NflGameTeam) {
    return teamFieldState(game, team, this.asOf());
  }

  protected isWinner(game: NflGame, team: NflGameTeam): boolean {
    return winner(game, this.asOf()) === team;
  }

  protected counts(game: NflGame): number[] {
    return this.sides().map((side) => playersInGame(game, side.starters));
  }

  protected status(game: NflGame): string {
    switch (this.phase(game)) {
      case 'live':
        return game.detail ?? 'Live';
      case 'final':
        return game.statusText || 'Final';
      default:
        return formatGameTime(game.kickoffUtc) ?? game.statusText;
    }
  }

  protected queryParams(): Record<string, number> {
    const team = this.linkTeam();
    return team === null ? {} : { team };
  }

  // Everything the card shows, for screen readers.
  protected cardLabel(game: NflGame): string {
    const { away, home } = game;
    const score = (t: NflGameTeam) => (t.score === null ? t.abbrev : `${t.abbrev} ${t.score}`);
    const parts = [`${score(away)} at ${score(home)}`, this.phase(game) === 'live' ? `Live, ${this.status(game)}` : this.status(game)];
    const field = [away, home].find((t) => this.fieldState(game, t) !== 'none');
    if (field) parts.push(`${field.abbrev} ${this.fieldState(game, field) === 'redZone' ? 'in the red zone' : 'has the ball'}`);
    const counts = this.counts(game);
    if (counts.length) {
      parts.push(
        'Starters: ' + this.sides().map((side, i) => `${side.abbrev} ${counts[i]}`).join(', '),
      );
    }
    return parts.join('. ');
  }
}
