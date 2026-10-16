// Board colours, piece sets and the progress milestones that unlock some of them.
// A player's choices live in progress.look ({ avatar, colour, board, pieces, unlocked: [...] }).
import { setPieceSet } from './board.js';

// Milestones: earned by learning, the same rules for every player.
// `have(p)` reads the player's progress record; `need` is the target.
export const MILESTONES = [
  { id: 'streak7', label: 'Keep a 7-day puzzle streak', unit: 'days', need: 7, have: (p) => (p.streak && p.streak.best) || 0 },
  { id: 'library5', label: 'Read 5 library entries', unit: 'entries', need: 5, have: (p) => Object.keys((p.lib && p.lib.seen) || {}).length },
  { id: 'matches10', label: 'Play 10 matches', unit: 'matches', need: 10, have: (p) => ((p.match && p.match.games) || []).length },
  { id: 'puzzles100', label: 'Solve 100 puzzles', unit: 'puzzles', need: 100, have: (p) => Object.values(p.themes || {}).reduce((n, t) => n + (t.solved || 0), 0) },
  { id: 'coachFix', label: 'Fix a weakness with the Coach', unit: 'fixed', need: 1, have: (p) => {
    const c = p.curr || {};
    return Math.max(Object.keys(c.mastered || {}).length, (c.log || []).filter((l) => l.what === 'mastered').length);
  } },
  { id: 'streak30', label: 'Keep a 30-day puzzle streak', unit: 'days', need: 30, have: (p) => (p.streak && p.streak.best) || 0 },
];

// Boards: light and dark square colours. `classic` keeps the app's own colours
// (which also soften in dark mode).
export const BOARDS = [
  { id: 'classic', label: 'Classic', light: null, dark: null },
  { id: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
  { id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'pink', label: 'Pink', light: '#f7dfe7', dark: '#d58aa4' },
  { id: 'grey', label: 'Stone', light: '#e2e2dc', dark: '#94978f' },
  { id: 'ice', label: 'Ice', light: '#e8f3f8', dark: '#79aecb', unlock: 'streak7' },
  { id: 'coral', label: 'Coral', light: '#fbe5da', dark: '#df8469', unlock: 'library5' },
  { id: 'purple', label: 'Purple', light: '#ece5f7', dark: '#9479c6', unlock: 'matches10' },
  { id: 'teal', label: 'Teal', light: '#dcefec', dark: '#4a978f', unlock: 'puzzles100' },
  { id: 'night', label: 'Night', light: '#bfc4d6', dark: '#5f6789', unlock: 'coachFix' },
  { id: 'royal', label: 'Gold', light: '#f5e9c6', dark: '#b8913f', unlock: 'streak30' },
];

// Piece sets (from the Lichess collection; licences in README). `dir: ''` is the original set.
export const PIECE_SETS = [
  { id: 'classic', label: 'Classic', dir: '' },
  { id: 'merida', label: 'Merida', dir: 'merida' },
  { id: 'chessnut', label: 'Chessnut', dir: 'chessnut' },
  { id: 'bold', label: 'Bold', dir: 'totoy' },
  { id: 'celtic', label: 'Celtic', dir: 'celtic', unlock: 'streak7' },
  { id: 'warm', label: 'Warm', dir: 'rhosgfx', unlock: 'library5' },
  { id: 'papercut', label: 'Papercut', dir: 'papercut', unlock: 'matches10' },
  { id: 'spatial', label: 'Spatial', dir: 'spatial', unlock: 'puzzles100' },
  { id: 'fantasy', label: 'Fantasy', dir: 'fantasy', unlock: 'coachFix' },
  { id: 'gold', label: 'Gold', dir: 'firi', unlock: 'streak30' },
];

export const milestone = (id) => MILESTONES.find((m) => m.id === id) || null;
export const boardById = (id) => BOARDS.find((b) => b.id === id) || BOARDS[0];
export const piecesById = (id) => PIECE_SETS.find((s) => s.id === id) || PIECE_SETS[0];

export const pieceUrl = (set, color, type) => new URL(`../img/pieces/${set.dir ? set.dir + '/' : ''}${color}${type.toUpperCase()}.svg`, import.meta.url).href;

// Milestones reached now that weren't recorded yet. Once recorded they stay
// unlocked, even if (say) a streak later resets.
export function newlyUnlocked(p) {
  const done = new Set((p.look && p.look.unlocked) || []);
  return MILESTONES.filter((m) => !done.has(m.id) && m.have(p) >= m.need).map((m) => m.id);
}
export const isUnlocked = (look, item) => !item.unlock || ((look && look.unlocked) || []).includes(item.unlock);

// Put a player's board and pieces into effect for every board the app draws.
export function applyLook(look) {
  const root = document.documentElement.style;
  const b = boardById(look && look.board);
  const s = piecesById(look && look.pieces);
  if (b.light && isUnlocked(look, b)) {
    root.setProperty('--sq-light', b.light);
    root.setProperty('--sq-dark', b.dark);
  } else {
    root.removeProperty('--sq-light');
    root.removeProperty('--sq-dark');
  }
  setPieceSet(isUnlocked(look, s) ? s.dir : '');
}
