// Names the tactic behind a mistake, from a position and the engine's line.
// Used by the curriculum (Pillar 4) to turn every analysed game into evidence:
// "you walked into a fork here", "you had a pin here and missed it".
// Works from stored analysis only, so it costs no extra engine time.
import { Chess, VALUE, NAME, other, playUci, attackers, materialSwing } from './chessutil.js';

const FILES = 'abcdefgh';
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function sq(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + (r + 1) : null; }
function fr(s) { return [FILES.indexOf(s[0]), +s[1] - 1]; }
function dirsFor(type) { return type === 'b' ? DIAG : type === 'r' ? ORTH : type === 'q' ? DIAG.concat(ORTH) : []; }
function label(p, at) { return p.type === 'k' ? 'the king' : `the ${NAME[p.type]} on ${at}`; }
function join(xs) { return xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }

// Pieces attacked by the piece on `from` that it can actually win: the king,
// anything undefended, or anything worth more than the attacker.
function forkTargets(c, from) {
  const p = c.get(from);
  if (!p) return [];
  const out = [];
  for (const row of c.board()) for (const t of row) {
    if (!t || t.color === p.color) continue;
    if (!attackers(c, t.square, p.color).includes(from)) continue;
    const defended = attackers(c, t.square, t.color).length > 0;
    if (t.type === 'k' || !defended || VALUE[t.type] > VALUE[p.type]) out.push(t);
  }
  return out;
}

function worth(c, t) {
  return t.type === 'k' || VALUE[t.type] >= 3 || attackers(c, t.square, t.color).length === 0;
}

// After move m (already played on c): did moving away uncover an attack?
function discovered(c, m) {
  const [mf, mr] = fr(m.from);
  for (const row of c.board()) for (const x of row) {
    if (!x || x.color !== m.color || x.square === m.to || !'brq'.includes(x.type)) continue;
    const [xf, xr] = fr(x.square);
    const df = Math.sign(mf - xf), dr = Math.sign(mr - xr);
    const aligned = (mf - xf === 0 || mr - xr === 0 || Math.abs(mf - xf) === Math.abs(mr - xr)) && (df || dr);
    if (!aligned || !dirsFor(x.type).some(([a, b]) => a === df && b === dr)) continue;
    // Squares from x up to (and past) m.from must be empty now.
    let f = xf + df, r = xr + dr, passed = false, blocked = false;
    while (sq(f, r)) {
      const s = sq(f, r);
      if (s === m.from) passed = true;
      const t = c.get(s);
      if (t) {
        if (!passed) { blocked = true; break; }
        if (t.color !== m.color && worth(c, { ...t, square: s })) return { by: x, byAt: x.square, target: t, at: s };
        break;
      }
      f += df; r += dr;
    }
    if (blocked) continue;
  }
  return null;
}

// Pin or skewer created by the moved line piece.
function lineTactic(c, m) {
  const p = c.get(m.to);
  if (!p) return null;
  const [f0, r0] = fr(m.to);
  for (const [df, dr] of dirsFor(p.type)) {
    let f = f0 + df, r = r0 + dr, front = null;
    while (sq(f, r)) {
      const s = sq(f, r);
      const t = c.get(s);
      if (t) {
        if (t.color === p.color) break;
        if (!front) { front = { ...t, square: s }; f += df; r += dr; continue; }
        const back = { ...t, square: s };
        if (back.type === 'k') return { motif: 'pin', front, back };
        if (front.type === 'k' || VALUE[front.type] > VALUE[back.type]) {
          if (worth(c, back)) return { motif: 'skewer', front, back };
        } else if (VALUE[back.type] > VALUE[front.type]) return { motif: 'pin', front, back };
        break;
      }
      f += df; r += dr;
    }
  }
  return null;
}

function look(fenBefore, uci) {
  const c = new Chess(fenBefore);
  const before = new Chess(fenBefore);
  const m = playUci(c, uci);
  if (!m) return null;
  if (m.promotion) return { motif: 'promotion', san: m.san, detail: `promotes the pawn on ${m.to}` };
  const forks = forkTargets(c, m.to);
  const big = forks.filter((t) => t.type === 'k' || VALUE[t.type] >= 3);
  if (big.length >= 2) {
    forks.sort((a, b) => (b.type === 'k') - (a.type === 'k') || VALUE[b.type] - VALUE[a.type]);
    return { motif: 'fork', san: m.san, detail: `forks ${join(forks.slice(0, 3).map((t) => label(t, t.square)))}` };
  }
  const d = discovered(c, m);
  if (d) return { motif: 'discoveredAttack', san: m.san, detail: `moves out of the way so the ${NAME[d.by.type]} on ${d.byAt} attacks ${label(d.target, d.at)}` };
  const lt = lineTactic(c, m);
  if (lt) {
    return lt.motif === 'pin'
      ? { motif: 'pin', san: m.san, detail: `pins ${label(lt.front, lt.front.square)} to ${label(lt.back, lt.back.square)}` }
      : { motif: 'skewer', san: m.san, detail: `skewers ${label(lt.front, lt.front.square)} — when it moves, ${label(lt.back, lt.back.square)} falls` };
  }
  if (m.captured) {
    const defended = attackers(before, m.to, other(m.color)).length > 0;
    if (!defended) return { motif: 'hangingPiece', san: m.san, detail: `takes the undefended ${NAME[m.captured]} on ${m.to}` };
    if (VALUE[m.captured] > VALUE[m.piece]) return { motif: 'hangingPiece', san: m.san, detail: `wins the ${NAME[m.captured]} on ${m.to} for a ${NAME[m.piece]}` };
  }
  return null;
}

function backRankMate(c, attacker) {
  const def = other(attacker);
  const rank = def === 'w' ? '1' : '8';
  let k = null;
  for (const row of c.board()) for (const t of row) if (t && t.type === 'k' && t.color === def) k = t.square;
  if (!k || k[1] !== rank) return false;
  // The mating rook or queen comes along the rank from a distance, and the
  // king is boxed in by its own pieces in front of it.
  const kf = FILES.indexOf(k[0]);
  const along = attackers(c, k, attacker).some((s) => s[1] === rank && 'rq'.includes(c.get(s).type) && Math.abs(FILES.indexOf(s[0]) - kf) >= 2);
  if (!along) return false;
  const fwd = def === 'w' ? '2' : '7';
  const own = [kf - 1, kf, kf + 1].map((f) => sq(f, +fwd - 1)).filter(Boolean).filter((s) => { const t = c.get(s); return t && t.color === def; });
  return own.length >= 2;
}

// Classify the tactic in `pv` (engine line, side `attacker` to move first).
// `mateIn` = n if the line is a forced mate in n for the attacker.
// Returns { motif, san, detail } or null when nothing trainable stands out.
export function classifyTactic(fen, pv, attacker, mateIn = null) {
  if (!pv || !pv.length) return null;
  const first = new Chess(fen);
  if (first.turn() !== attacker) return null;
  const firstSan = (() => { const c = new Chess(fen); const m = playUci(c, pv[0]); return m ? m.san : null; })();
  if (!firstSan) return null;
  if (mateIn) {
    const c = new Chess(fen);
    let last = null;
    for (const u of pv.slice(0, 2 * mateIn - 1)) { last = playUci(c, u); if (!last) break; }
    const done = last && c.isCheckmate();
    if (done && backRankMate(c, attacker)) return { motif: 'backRankMate', san: firstSan, detail: mateIn === 1 ? 'is checkmate on the back rank' : `starts a back-rank mate in ${mateIn}` };
    if (mateIn === 1) return { motif: 'mateIn1', san: firstSan, detail: 'is checkmate' };
    return { motif: 'mateIn2', san: firstSan, detail: `starts a forced mate in ${mateIn}` };
  }
  const gain = materialSwing(fen, pv, attacker).delta;
  if (gain < 2) return null;
  const a = look(fen, pv[0]);
  if (a) return a;
  // The first move is often a check or capture that sets the tactic up.
  if (pv.length >= 3) {
    const c = new Chess(fen);
    if (playUci(c, pv[0]) && playUci(c, pv[1])) {
      const b = look(c.fen(), pv[2]);
      if (b) return { ...b, san: firstSan, detail: `${firstSan} sets up ${b.san}, which ${b.detail}` , setup: true };
    }
  }
  // A pawn promoting somewhere in the line.
  const c = new Chess(fen);
  for (let i = 0; i < Math.min(pv.length, 5); i++) {
    const m = playUci(c, pv[i]);
    if (!m) break;
    if (m.promotion && m.color === attacker) return { motif: 'promotion', san: firstSan, detail: `${i ? 'leads to ' : ''}a pawn promoting on ${m.to}` };
  }
  return null;
}
