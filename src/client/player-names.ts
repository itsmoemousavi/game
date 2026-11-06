import { HEROES, Team, Unit } from '../sim';
import type { LobbyPlayer } from '../net/session';

/** One per seat (0-2 Blue, 3-5 Red), so every phone calls the same bot the same thing. */
const BOT_NAMES = ['Bot Ash', 'Bot Rook', 'Bot Wren', 'Bot Flint', 'Bot Moss', 'Bot Thorn'];
export const botName = (seat: number) => BOT_NAMES[seat] ?? 'Bot';
export const seatOf = (team: Team, seat: number) => team * 3 + seat;

/** Names by seat, for a multiplayer lobby: its players, and bots in the empty seats. */
export const seatNames = (seats: (number | null)[], players: LobbyPlayer[]): string[] =>
  seats.map((id, seat) => players.find((p) => p.id === id)?.name ?? botName(seat));

let heroNames = new Map<number, string>();
/** Start of a match: who plays each hero. `names` is in the same order as the world's heroes. */
export function setHeroNames(heroes: Unit[], names: string[]) {
  heroNames = new Map(heroes.map((u, i) => [u.id, names[i] ?? HEROES[u.hero!.defId].name]));
}
/** The player's name: for kill feed, overhead labels, announcements. */
export const heroName = (u: Unit) => heroNames.get(u.id) ?? HEROES[u.hero!.defId].name;
/** For scoreboards: `Player (Brakk)`. */
export const rosterName = (u: Unit) => `${heroName(u)} (${HEROES[u.hero!.defId].name})`;

/** Names come from other players: never put one into a page as code. */
export const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
