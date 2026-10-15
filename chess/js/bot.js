// The match opponent: Stockfish, weakened to play like a person of a given
// rating. It searches shallowly, picks among its top few moves with some
// randomness (bigger mistakes are less likely), and now and then slips.
import { engine } from './engine.js';
import { Chess, playUci, cpOf, VALUE } from './chessutil.js';

export function botParams(level) {
  const L = Math.max(400, Math.min(2200, level));
  return {
    depth: L < 800 ? 2 : L < 1000 ? 4 : L < 1200 ? 5 : L < 1450 ? 8 : L < 1700 ? 10 : 13,
    // How readily it plays a worse move: centipawn "temperature".
    temp: Math.max(15, 330 - 0.165 * L),
    // Chance per move of an outright slip (a move outside its sensible list).
    slip: Math.max(0.015, Math.min(0.18, 0.17 - (L - 600) * 0.00012)),
    // Chance it spots a mate in one / a free queen.
    sees: Math.max(0.55, Math.min(0.99, 0.35 + L / 2000)),
  };
}

const rnd = () => Math.random();

function pickWeighted(items, weight) {
  const w = items.map(weight);
  const total = w.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// Moves a person might "slip" into: plausible-looking (captures, checks,
// central pieces), not completely random.
function plausibleMoves(fen) {
  const c = new Chess(fen);
  return c.moves({ verbose: true }).map((m) => {
    let w = 1;
    if (m.captured) w += 2;
    if (m.san.includes('+')) w += 1.5;
    if ('nb'.includes(m.piece) && ('18'.includes(m.from[1]))) w += 1.5; // developing
    if (m.piece === 'k' && !m.san.startsWith('O-O')) w *= 0.3;
    if (m.piece === 'q') w *= 0.8;
    return { uci: m.from + m.to + (m.promotion || ''), w };
  });
}

export async function botMove(fen, level) {
  const P = botParams(level);
  const c = new Chess(fen);
  const legal = c.moves({ verbose: true });
  if (legal.length === 1) return { uci: legal[0].from + legal[0].to + (legal[0].promotion || ''), note: 'only' };
  const r = await engine.analyse(fen, { depth: P.depth, multipv: 5 });
  const lines = r.lines.filter((l) => l.pv && l.pv.length);
  if (!lines.length) return { uci: r.bestmove, note: 'best' };
  const scored = lines.map((l) => ({ uci: l.pv[0], cp: cpOf(l.mate !== undefined ? { mate: l.mate } : { cp: l.cp }) }));
  const best = scored[0];

  // Obvious wins: mate in one, or a big free capture. Usually spotted.
  if (lines[0].mate === 1 && rnd() < P.sees) return { uci: best.uci, note: 'mate' };
  const bm = playUci(new Chess(fen), best.uci);
  if (bm && bm.captured && VALUE[bm.captured] >= 5 && best.cp - (scored[1]?.cp ?? -99999) > 300 && rnd() < P.sees) {
    return { uci: best.uci, note: 'take' };
  }

  // Occasional slip.
  if (rnd() < P.slip) {
    const pool = plausibleMoves(fen).filter((m) => !scored.slice(0, 2).some((s) => s.uci === m.uci));
    if (pool.length) return { uci: pickWeighted(pool, (m) => m.w).uci, note: 'slip' };
  }

  // Softmax over the top lines by how much worse each is than the best.
  const choice = pickWeighted(scored, (s) => Math.exp(-Math.min(2000, best.cp - s.cp) / P.temp));
  return { uci: choice.uci, note: choice === best ? 'best' : 'alt' };
}

// Should the bot accept a draw offer? It takes one when the game is level
// after a decent number of moves, or when it's worse.
export async function botAcceptsDraw(fen, botColor, plies) {
  const r = await engine.analyse(fen, { depth: 10 });
  const l = r.lines[0];
  if (!l) return false;
  const stm = fen.split(' ')[1];
  let cp = cpOf(l.mate !== undefined ? { mate: l.mate } : { cp: l.cp });
  if (stm !== botColor) cp = -cp;
  return (plies >= 30 && Math.abs(cp) < 60) || (plies >= 16 && cp < -150);
}
