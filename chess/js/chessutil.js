// Small chess helpers shared by analysis, explanations and the intent checker.
import { Chess } from '../vendor/chess.js';

export { Chess };

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const COLOR_NAME = { w: 'White', b: 'Black' };
export const other = (c) => (c === 'w' ? 'b' : 'w');

const SQUARES = [];
for (const r of '87654321') for (const f of 'abcdefgh') SQUARES.push(f + r);
export { SQUARES };

export function uciToObj(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

export function moveToUci(m) {
  return m.from + m.to + (m.promotion || '');
}

// Play a UCI move on a chess.js instance; returns the verbose move or null.
export function playUci(chess, uci) {
  try {
    return chess.move(uciToObj(uci));
  } catch {
    return null;
  }
}

export function sanOf(fen, uci) {
  const c = new Chess(fen);
  const m = playUci(c, uci);
  return m ? m.san : uci;
}

// Material from White's point of view.
export function materialWhite(chess) {
  let s = 0;
  for (const row of chess.board()) for (const p of row) if (p) s += (p.color === 'w' ? 1 : -1) * VALUE[p.type];
  return s;
}

export function materialFor(chess, color) {
  const m = materialWhite(chess);
  return color === 'w' ? m : -m;
}

// --- Scores -------------------------------------------------------------
// An engine score is {cp} or {mate}. We normalise to White's point of view.

export function toWhitePov(line, fen) {
  const stm = fen.split(' ')[1];
  const sign = stm === 'w' ? 1 : -1;
  if (line.mate !== undefined) return { mate: line.mate * sign };
  return { cp: line.cp * sign };
}

export function scoreFor(scoreWhite, color) {
  if (!scoreWhite) return null;
  const sign = color === 'w' ? 1 : -1;
  if (scoreWhite.mate !== undefined) return { mate: scoreWhite.mate * sign };
  return { cp: scoreWhite.cp * sign };
}

export function cpOf(score) {
  if (score.mate !== undefined) {
    if (score.mate === 0) return -10000; // side to move is mated
    return score.mate > 0 ? 10000 - score.mate * 10 : -10000 - score.mate * 10;
  }
  return score.cp;
}

// Lichess-style winning chances, 0..100, for the side the score belongs to.
export function winPct(score) {
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  if (Math.abs(score.cp) >= 10000) return score.cp > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function describeStanding(pct) {
  if (pct >= 88) return 'winning';
  if (pct >= 70) return 'clearly better';
  if (pct >= 58) return 'a bit better';
  if (pct > 42) return 'about equal';
  if (pct > 30) return 'a bit worse';
  if (pct > 12) return 'clearly worse';
  return 'losing';
}

export function pawnsText(n) {
  const a = Math.abs(n);
  if (a >= 8.5) return 'a queen';
  if (a >= 4.5) return a >= 6 ? 'a rook and more' : 'a rook';
  if (a >= 2.5) return a >= 4 ? 'a piece and a pawn' : 'a piece';
  if (a >= 1.5) return 'two pawns';
  if (a >= 0.5) return 'a pawn';
  return 'nothing';
}

// --- Board geometry -------------------------------------------------------

export function nullMoveFen(fen) {
  // Same position, other side to move. Not valid if the side to move is in check.
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

export function nullMoveOk(fen) {
  const c = new Chess(fen);
  if (c.inCheck()) return false;
  try {
    const n = new Chess(nullMoveFen(fen));
    return !n.isGameOver();
  } catch {
    return false;
  }
}

export function attackers(chess, square, byColor) {
  try {
    return chess.attackers(square, byColor);
  } catch {
    return [];
  }
}

// Pieces of `color` that are attacked and not adequately defended.
export function loosePieces(chess, color) {
  const out = [];
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (!p || p.color !== color || p.type === 'k') continue;
    const att = attackers(chess, sq, other(color));
    if (!att.length) continue;
    const def = attackers(chess, sq, color);
    const cheapest = Math.min(...att.map((s) => VALUE[chess.get(s).type] || 0.5));
    if (!def.length || cheapest < VALUE[p.type]) out.push({ square: sq, piece: p, attackers: att, defenders: def });
  }
  return out;
}

// Squares holding `color` pieces attacked by the piece on `from`.
export function targetsOf(chess, from) {
  const p = chess.get(from);
  if (!p) return [];
  const out = [];
  for (const sq of SQUARES) {
    const t = chess.get(sq);
    if (!t || t.color === p.color) continue;
    if (attackers(chess, sq, p.color).includes(from)) out.push({ square: sq, piece: t });
  }
  return out;
}

export function kingSquare(chess, color) {
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (p && p.type === 'k' && p.color === color) return sq;
  }
  return null;
}

// Number of legal moves `color` would have in this position.
export function mobility(fen, color) {
  const f = fen.split(' ')[1] === color ? fen : nullMoveFen(fen);
  try {
    return new Chess(f).moves().length;
  } catch {
    return 0;
  }
}

export function developedCount(chess, color) {
  const home = color === 'w' ? { b1: 'n', g1: 'n', c1: 'b', f1: 'b' } : { b8: 'n', g8: 'n', c8: 'b', f8: 'b' };
  let n = 0;
  for (const [sq, t] of Object.entries(home)) {
    const p = chess.get(sq);
    if (!(p && p.type === t && p.color === color)) n++;
  }
  return n;
}

export function pawnIssues(chess, color) {
  const files = {};
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (p && p.type === 'p' && p.color === color) files[sq[0]] = (files[sq[0]] || 0) + 1;
  }
  let doubled = 0, isolated = 0;
  const fl = 'abcdefgh';
  for (const [f, n] of Object.entries(files)) {
    if (n > 1) doubled += n - 1;
    const i = fl.indexOf(f);
    if (!files[fl[i - 1]] && !files[fl[i + 1]]) isolated += n;
  }
  return { doubled, isolated };
}

// Plain-English description of one move, from the reviewer's point of view.
export function describeMove(move, hero) {
  const who = move.color === hero ? 'You' : 'They';
  const whose = move.color === hero ? 'your' : 'their';
  const theirs = move.color === hero ? 'their' : 'your';
  let s;
  if (move.san.startsWith('O-O-O')) s = `${who} castle queenside`;
  else if (move.san.startsWith('O-O')) s = `${who} castle kingside`;
  else if (move.captured) s = `${who} take ${theirs} ${NAME[move.captured]} on ${move.to} with ${whose} ${NAME[move.piece]}`;
  else s = `${who} move ${whose} ${NAME[move.piece]} to ${move.to}`;
  if (move.promotion) s += ` and promote to a ${NAME[move.promotion]}`;
  if (move.san.includes('#')) s += ' — checkmate';
  else if (move.san.includes('+')) s += ', with check';
  return s + '.';
}

// Play out a UCI line; returns steps with SAN, text and material after each ply.
export function playLine(fen, pv, hero, maxPlies = 10) {
  const c = new Chess(fen);
  const steps = [];
  for (const uci of pv.slice(0, maxPlies)) {
    const before = c.fen();
    const m = playUci(c, uci);
    if (!m) break;
    steps.push({ uci, san: m.san, move: m, fenBefore: before, fen: c.fen(), text: describeMove(m, hero), material: materialFor(c, hero) });
  }
  return steps;
}

// Material change for `hero` along a line, stopping at a quiet point so we
// don't end in the middle of a trade.
export function materialSwing(fen, pv, hero, maxPlies = 8) {
  const c = new Chess(fen);
  const start = materialFor(c, hero);
  let settled = start;
  let firstLossPly = -1;
  const plies = pv.slice(0, maxPlies);
  for (let i = 0; i < plies.length; i++) {
    const m = playUci(c, plies[i]);
    if (!m) break;
    const next = plies[i + 1] ? uciToObj(plies[i + 1]) : null;
    const nextIsCapture = next && c.get(next.to);
    if (!nextIsCapture) settled = materialFor(c, hero);
    if (firstLossPly < 0 && materialFor(c, hero) < start) firstLossPly = i;
  }
  return { delta: settled - start, firstLossPly };
}

export function squareName(sq) {
  return sq;
}
