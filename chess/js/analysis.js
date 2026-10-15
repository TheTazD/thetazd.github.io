// Whole-game analysis: one engine evaluation per position, then each move is
// graded by how much it changed the mover's winning chances.
import { engine } from './engine.js';
import { Chess, toWhitePov, scoreFor, winPct, moveToUci } from './chessutil.js';

export const ANALYSIS_VERSION = 1;
export const QUICK_DEPTH = 14;

export const GRADES = {
  best: { label: 'Best move', short: 'Best', symbol: '★', tone: 'good' },
  good: { label: 'Good move', short: 'Good', symbol: '✓', tone: 'good' },
  inaccuracy: { label: 'Inaccuracy', short: 'Inaccuracy', symbol: '?!', tone: 'meh' },
  mistake: { label: 'Mistake', short: 'Mistake', symbol: '?', tone: 'bad' },
  blunder: { label: 'Blunder', short: 'Blunder', symbol: '??', tone: 'worst' },
  book: { label: 'Opening move', short: 'Opening', symbol: '', tone: 'good' },
};

// Parse a game into positions and verbose moves.
export function gameLine(pgn) {
  const c = new Chess();
  c.loadPgn(pgn);
  const moves = c.history({ verbose: true });
  const headers = c.getHeaders ? c.getHeaders() : c.header();
  // Puzzles start from a set-up position (FEN header), not the opening.
  const r = headers.FEN ? new Chess(headers.FEN) : new Chess();
  const fens = [r.fen()];
  for (const m of moves) {
    r.move({ from: m.from, to: m.to, promotion: m.promotion });
    fens.push(r.fen());
  }
  return { moves, fens, headers };
}

function terminalScore(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { cp: c.turn() === 'w' ? -100000 : 100000 };
  if (c.isDraw() || c.isStalemate()) return { cp: 0 };
  return null;
}

// Evaluate one position; returns {score (White POV), best, pv, depth}.
export async function evalPosition(fen, depth = QUICK_DEPTH) {
  const t = terminalScore(fen);
  if (t) return { score: t, best: null, pv: [], depth: 99 };
  const r = await engine.analyse(fen, { depth });
  const line = r.lines[0];
  if (!line) return { score: { cp: 0 }, best: r.bestmove, pv: r.bestmove ? [r.bestmove] : [], depth: 0 };
  return { score: toWhitePov(line, fen), best: line.pv[0], pv: line.pv, depth: line.depth };
}

// Analyse every position, reporting progress. Reuses evals already stored.
export async function analyseGame(fens, existing = [], onProgress = () => {}) {
  const evals = existing.slice();
  for (let i = 0; i < fens.length; i++) {
    if (!evals[i]) evals[i] = await evalPosition(fens[i]);
    onProgress(i + 1, fens.length, evals);
  }
  return evals;
}

export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

// Grade ply i (1-based: moves[i-1] played from fens[i-1]).
export function gradeMove(i, moves, evals) {
  const m = moves[i - 1];
  const eb = evals[i - 1], ea = evals[i];
  if (!eb || !ea) return null;
  const mover = m.color;
  const before = scoreFor(eb.score, mover);
  const after = scoreFor(ea.score, mover);
  const wb = winPct(before), wa = winPct(after);
  const loss = Math.max(0, wb - wa);
  const played = moveToUci(m);
  let grade;
  if (eb.best && played === eb.best) grade = 'best';
  else if (loss >= 15) grade = 'blunder';
  else if (loss >= 10) grade = 'mistake';
  else if (loss >= 5) grade = 'inaccuracy';
  else grade = 'good';
  // Missing a forced mate is always worth pointing out.
  if (before.mate > 0 && !(after.mate > 0) && grade === 'good') grade = 'inaccuracy';
  return { ply: i, grade, loss, wb, wa, before, after, mover, played, best: eb.best, accuracy: moveAccuracy(loss) };
}

export function gradeAll(moves, evals) {
  const out = [];
  for (let i = 1; i <= moves.length; i++) out.push(gradeMove(i, moves, evals));
  return out;
}

export function summarise(grades, hero) {
  const mine = grades.filter((g) => g && g.mover === hero);
  const count = (k) => mine.filter((g) => g.grade === k).length;
  const acc = mine.length ? mine.reduce((s, g) => s + g.accuracy, 0) / mine.length : null;
  return {
    accuracy: acc === null ? null : Math.round(acc),
    inaccuracies: count('inaccuracy'),
    mistakes: count('mistake'),
    blunders: count('blunder'),
  };
}

export function isFlagged(g) {
  return g && (g.grade === 'inaccuracy' || g.grade === 'mistake' || g.grade === 'blunder');
}
