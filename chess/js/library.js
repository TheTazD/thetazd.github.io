// Pillar 5: library logic — turning the content into lines and puzzles,
// spotting which openings a player actually meets, practice sets, progress.
import { OPENINGS, MATES } from './library-data.js';
import { Chess, playUci, nullMoveFen, moveToUci } from './chessutil.js';
import { pickFromTheme } from './puzzles.js';
import { registerThemeNames } from './themes.js';

export { OPENINGS, MATES };

export const ENTRIES = {};
for (const o of OPENINGS) ENTRIES[o.id] = { ...o, type: 'opening' };
for (const m of MATES) ENTRIES[m.id] = { ...m, type: 'mate' };
export const entry = (id) => ENTRIES[id] || null;

// Names for puzzle themes that only the library uses, so archived attempts
// and the review screen show a proper title.
const names = {};
for (const o of OPENINGS) names['open:' + o.id] = o.name;
for (const m of MATES) if (m.angle) names[m.angle] = m.name;
registerThemeNames(names);

const split = (s) => (s ? s.trim().split(/\s+/) : []);

// ---------------------------------------------------------------------------
// Lines to step through
// ---------------------------------------------------------------------------
// A line: { fen: start, steps: [{ san, uci, fen, move: {from,to,color}, text }] }
function buildLine(startFen, sans, notes, fallback = '') {
  const c = new Chess(startFen || undefined);
  const fen = c.fen();
  const steps = [];
  const pre = sans.length - notes.length; // notes may cover only the last moves
  sans.forEach((san, i) => {
    const m = c.move(san);
    steps.push({ san: m.san, uci: moveToUci(m), fen: c.fen(), move: { from: m.from, to: m.to, color: m.color }, text: i >= pre ? notes[i - pre] : fallback });
  });
  return { fen, steps };
}

export function mainLine(e) {
  if (e.type === 'opening') return buildLine(null, split(e.moves), e.notes);
  const ex = e.example;
  return buildLine(ex.fen, split(ex.moves || ex.line), ex.notes);
}

export function trapLine(e) {
  if (!e.trap) return null;
  const l = buildLine(null, split(e.trap.moves), e.trap.notes, 'The usual opening moves — the trap is coming.');
  const pre = l.steps.length - e.trap.notes.length;
  if (pre > 0) l.steps[pre - 1].text = e.trap.from; // the move where the trap line begins
  return l;
}

// Moves numbered for display: "1.e4 e5 2.Nf3 …", starting from any position.
export function numbered(line, from = 0, to = line.steps.length) {
  const out = [];
  const startMove = +line.fen.split(' ')[5];
  const startBlack = line.fen.split(' ')[1] === 'b';
  for (let i = from; i < to; i++) {
    const s = line.steps[i];
    const ply = i + (startBlack ? 1 : 0);
    const n = startMove + Math.floor(ply / 2);
    if (s.move.color === 'w') out.push(`${n}.${s.san}`);
    else out.push(i === from ? `${n}…${s.san}` : s.san);
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// Practice puzzles (same shape as Pillar 2 puzzles, so the session screen,
// spaced repetition and archive all work on them)
// ---------------------------------------------------------------------------
function themeOf(e) {
  return e.type === 'opening' ? 'open:' + e.id : e.theme;
}

export function authoredPuzzles(e, side) {
  const items = (e.practice && e.practice[side]) || [];
  return items.map((it, k) => {
    const c = new Chess(it.fen || undefined);
    let last = null, fen;
    const mv = split(it.moves);
    for (let i = 0; i < mv.length; i++) {
      if (i === mv.length - 1 && it.kind !== 'threat') { fen = c.fen(); last = moveToUci(c.move(mv[i])); }
      else c.move(mv[i]);
    }
    if (!last) fen = c.fen();
    const base = {
      id: `lib:${e.id}:${side}:${k}`,
      theme: themeOf(e),
      r: null,
      live: true, // keep the data with the attempt so re-tests can find it
      concept: e.type === 'mate' ? e.how : e.trap ? e.trap.lesson : null,
      result: it.result || null,
      lib: { entry: e.id, side, note: it.note || null },
    };
    if (it.kind === 'threat') {
      // Stored with the attacker to move; the session flips it for the defence.
      const start = nullMoveFen(fen);
      const t = threatOf(start, it);
      return { kind: 'threat', p: { ...base, fen: start, last: null, sol: t ? [t] : [] } };
    }
    const s = new Chess(c.fen());
    const sol = split(it.sol).map((san) => moveToUci(s.move(san)));
    const p = { ...base, fen, last, sol };
    if (it.kind === 'avoid') { p.lib.bad = it.bad; p.lib.goodSan = it.sol; }
    return { kind: it.kind, p };
  });
}

// The threat in a "spot the threat" position: the given one, or the first
// checkmate the attacker has, or failing that the first capture.
function threatOf(startFen, it) {
  const c = new Chess(startFen);
  if (it.threat) return moveToUci(c.move(it.threat));
  const moves = c.moves({ verbose: true });
  for (const m of moves) {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) return moveToUci(m);
  }
  // Mate in two: a check after which every reply allows mate.
  for (const m of moves.filter((x) => x.san.includes('+'))) {
    c.move(m);
    const replies = c.moves({ verbose: true });
    const forced = replies.length > 0 && replies.every((r) => {
      c.move(r);
      const ok = c.moves({ verbose: true }).some((x) => { c.move(x); const mt = c.isCheckmate(); c.undo(); return mt; });
      c.undo();
      return ok;
    });
    c.undo();
    if (forced) return moveToUci(m);
  }
  const cap = moves.find((m) => m.captured && m.captured !== 'p');
  return cap ? moveToUci(cap) : null;
}

// A practice set for one entry and side: the hand-made positions first, then
// (for checkmate patterns) puzzles of that pattern from Lichess, fetched on
// the player's device the first time.
export async function buildLibrarySet(p, id, side, size = 5) {
  const e = entry(id);
  if (!e) throw new Error('That library entry no longer exists.');
  const items = authoredPuzzles(e, side).filter((x) => x.p.sol.length);
  if (side === 'deliver' && e.type === 'mate' && e.angle && items.length < size) {
    try {
      const more = await pickFromTheme(p, e.angle, size - items.length);
      for (const pz of more) items.push({ kind: 'solve', p: { ...pz, theme: e.angle, concept: e.how, lib: { entry: e.id, side, note: null } } });
    } catch (err) { console.warn('Library: no Lichess puzzles', err); }
  }
  return { mode: 'library', theme: themeOf(e), lib: { entry: e.id, side }, items };
}

// ---------------------------------------------------------------------------
// Which openings does this player actually play or face?
// ---------------------------------------------------------------------------
export function detectOpening(sans) {
  let best = null, len = 0;
  for (const o of OPENINGS) {
    for (const m of o.match) {
      if (m.length > len && m.length <= sans.length && m.every((s, i) => s === sans[i])) { best = o.id; len = m.length; }
    }
  }
  return best;
}

// From the archive: [{ id, played, faced, asWhite, asBlack, games: [gameId] }]
// "played" = it's the opening of the player's own side; "faced" = the other side's.
export function openingsFromGames(games) {
  const out = {};
  for (const g of games) {
    if (g.source === 'puzzle' || !g.pgn || (g.hero !== 'w' && g.hero !== 'b')) continue;
    let sans;
    try {
      const c = new Chess();
      c.loadPgn(g.pgn);
      sans = c.history().slice(0, 8);
    } catch { continue; }
    const id = detectOpening(sans);
    if (!id) continue;
    const o = out[id] || (out[id] = { id, played: 0, faced: 0, asWhite: 0, asBlack: 0, games: [] });
    if (ENTRIES[id].side === g.hero) o.played++; else o.faced++;
    if (g.hero === 'w') o.asWhite++; else o.asBlack++;
    o.games.push(g.id);
  }
  return Object.values(out).sort((a, b) => b.played + b.faced - (a.played + a.faced));
}

// ---------------------------------------------------------------------------
// Progress (kept in the per-player progress record, alongside puzzles)
// ---------------------------------------------------------------------------
export function libState(p) {
  p.lib = p.lib || {};
  p.lib.seen = p.lib.seen || {};
  p.lib.drill = p.lib.drill || {};
  p.lib.prac = p.lib.prac || {};
  return p.lib;
}

export function markSeen(p, id) {
  libState(p).seen[id] = Date.now();
}

export function recordDrill(p, id, color, firstTry, total) {
  const L = libState(p);
  const k = `${id}:${color}`;
  const d = L.drill[k] || (L.drill[k] = { runs: 0, best: 0, last: 0 });
  const pct = total ? Math.round((firstTry / total) * 100) : 0;
  d.runs++;
  d.last = pct;
  d.best = Math.max(d.best, pct);
  d.at = Date.now();
  return d;
}

export function recordPractice(p, id, side, results) {
  const L = libState(p);
  const k = `${id}:${side}`;
  const d = L.prac[k] || (L.prac[k] = { n: 0, ok: 0, sets: 0 });
  for (const r of results) if (r) { d.n++; d.ok += r.firstTry ? 1 : 0; }
  d.sets++;
  d.last = results.filter((r) => r && r.firstTry).length + '/' + results.length;
  d.at = Date.now();
  return d;
}

// A one-line status for an entry on the shelf.
export function entryStatus(p, e) {
  const L = libState(p);
  const parts = [];
  if (e.type === 'opening') {
    for (const c of ['w', 'b']) {
      const d = L.drill[`${e.id}:${c}`];
      if (d) parts.push({ text: `${c === 'w' ? 'White' : 'Black'} ${d.best}%`, ok: d.best >= 80 });
    }
  }
  for (const s of ['deliver', 'defend']) {
    const d = L.prac[`${e.id}:${s}`];
    if (d) parts.push({ text: `${s === 'deliver' ? 'Deliver' : 'Defend'} ${d.n ? Math.round((d.ok / d.n) * 100) : 0}%`, ok: d.n && d.ok / d.n >= 0.75 });
  }
  if (!parts.length && L.seen[e.id]) parts.push({ text: 'Read', ok: false });
  return parts;
}

export { playUci };
