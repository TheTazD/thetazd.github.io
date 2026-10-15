// Run with: node chess/scripts/check-library.mjs  (needs Node 18+)
// Verify library content: legality, mates, and engine checks of practice items.
import { spawn } from 'node:child_process';
import { Chess } from '../vendor/chess.js';
import { OPENINGS, MATES } from '../js/library-data.js';

const SF = new URL('../engine/stockfish-18-lite-single.js', import.meta.url).pathname;
const proc = spawn('node', [SF]);
let buf = '';
let waiters = [];
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    for (const w of waiters.slice()) w(line);
  }
});
const send = (s) => proc.stdin.write(s + '\n');
function until(pred) {
  return new Promise((res) => {
    const lines = [];
    const w = (l) => { lines.push(l); if (pred(l)) { waiters = waiters.filter((x) => x !== w); res(lines); } };
    waiters.push(w);
  });
}
send('uci'); await until((l) => l === 'uciok');
send('setoption name MultiPV value 1');
send('isready'); await until((l) => l === 'readyok');

// score of side to move: {cp} or {mate}
async function analyse(fen, { depth = 16, moves = null } = {}) {
  send('position fen ' + fen);
  send('go depth ' + depth + (moves ? ' searchmoves ' + moves.join(' ') : ''));
  const lines = await until((l) => l.startsWith('bestmove'));
  const info = lines.filter((l) => l.startsWith('info') && l.includes(' pv ')).pop();
  const best = lines[lines.length - 1].split(' ')[1];
  let score = {};
  const m = info && info.match(/score (cp|mate) (-?\d+)/);
  if (m) score = m[1] === 'cp' ? { cp: +m[2] } : { mate: +m[2] };
  if (!info) { // no legal moves
    const c = new Chess(fen);
    score = c.isCheckmate() ? { mate: 0 } : { cp: 0 };
  }
  return { best, score };
}
const win = (s) => (s.mate !== undefined ? (s.mate > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, s.cp)))) - 1));
const fmt = (s) => (s.mate !== undefined ? `#${s.mate}` : `${(s.cp / 100).toFixed(1)}`);
const uci = (m) => m.from + m.to + (m.promotion || '');

let problems = 0;
const bad = (...a) => { problems++; console.log('  ✗', ...a); };

function playSan(c, list, where) {
  const out = [];
  for (const s of list) {
    try { out.push(c.move(s)); } catch { bad(where, 'illegal move', s, 'at', c.fen()); return null; }
  }
  return out;
}
const split = (s) => (s ? s.trim().split(/\s+/) : []);

function nullFen(fen) { const p = fen.split(' '); p[1] = p[1] === 'w' ? 'b' : 'w'; p[3] = '-'; return p.join(' '); }

async function checkItem(it, where) {
  const c = new Chess(it.fen || undefined);
  if (it.moves && !playSan(c, split(it.moves), where)) return;
  const fen = c.fen();
  const me = c.turn();
  if (it.kind === 'solve' || it.kind === 'avoid') {
    const sol = split(it.sol);
    const cc = new Chess(fen);
    const mv = playSan(cc, sol, where + ' sol');
    if (!mv) return;
    if (it.sol.endsWith('#') && !cc.isCheckmate()) bad(where, 'claimed mate is not mate');
    // learner's moves are even indices
    let f = fen;
    const c2 = new Chess(fen);
    for (let k = 0; k < mv.length; k++) {
      if (k % 2 === 0) {
        const all = await analyse(f);
        const mine = await analyse(f, { moves: [uci(mv[k])] });
        const gap = win(all.score) - win(mine.score);
        const tag = `${where} step ${k / 2 + 1} ${mv[k].san}: ${fmt(mine.score)} (best ${all.best} ${fmt(all.score)})`;
        if (it.kind === 'solve' && (gap > 3 || (win(mine.score) < 75 && !where.startsWith('O:') && !it.open))) bad(tag, 'gap', gap.toFixed(1));
        else if (it.kind === 'avoid' && gap > 6) bad(tag, 'sound move not near best, gap', gap.toFixed(1));
        else console.log('  ✓', tag);
        if (it.kind === 'avoid') {
          const b = new Chess(f); let bm; try { bm = b.move(it.bad); } catch { bad(where, 'bad move illegal', it.bad); }
          if (bm) {
            const r = await analyse(f, { moves: [uci(bm)] });
            const drop = win(all.score) - win(r.score);
            if (drop < (it.open ? 6 : 10)) bad(where, `bad move ${it.bad} only drops ${drop.toFixed(1)} (${fmt(r.score)})`);
            else console.log(`    bad ${it.bad}: ${fmt(r.score)} drop ${drop.toFixed(0)}`);
          }
        }
      }
      c2.move(mv[k]); f = c2.fen();
    }
    return;
  }
  if (it.kind === 'threat') {
    if (c.inCheck()) return bad(where, 'defender in check');
    const nf = nullFen(fen);
    let n; try { n = new Chess(nf); } catch { return bad(where, 'null fen invalid'); }
    if (n.isGameOver()) return bad(where, 'null position game over');
    const t = await analyse(nf);
    const tsan = new Chess(nf).move({ from: t.best.slice(0, 2), to: t.best.slice(2, 4), promotion: t.best[4] }).san;
    const pass = 100 - win(t.score); // defender's chances if they pass
    const d = await analyse(fen);
    const def = win(d.score);
    const msg = `${where}: threat ${tsan} (${fmt(t.score)}), best defence ${d.best} → defender ${fmt(d.score)} [${def.toFixed(0)}% vs pass ${pass.toFixed(0)}%]`;
    if (def - pass < 25) bad(msg, 'threat not serious or no defence');
    else if (def < 20) bad(msg, 'no real defence');
    else console.log('  ✓', msg);
    it._threat = tsan;
  }
}

for (const o of OPENINGS) {
  console.log('OPENING', o.id);
  const c = new Chess();
  const mv = playSan(c, split(o.moves), o.id);
  if (mv && mv.length !== o.notes.length) bad(o.id, `notes ${o.notes.length} vs plies ${mv.length}`);
  for (const m of o.match) playSan(new Chess(), m, o.id + ' match');
  if (o.trap) {
    const t = playSan(new Chess(), split(o.trap.moves), o.id + ' trap');
    if (t && t.length < o.trap.notes.length) bad(o.id, `trap notes ${o.trap.notes.length} vs plies ${t.length}`);
    const end = new Chess(); split(o.trap.moves).forEach((s) => end.move(s));
    if (o.trap.moves.endsWith('#') && !end.isCheckmate()) bad(o.id, 'trap mate not mate');
  }
  for (const side of ['deliver', 'defend']) for (const [k, it] of o.practice[side].entries()) await checkItem(it, `O:${o.id} ${side}${k}`);
}
for (const m of MATES) {
  console.log('MATE', m.id);
  const ex = m.example;
  const c = new Chess(ex.fen || undefined);
  const mv = playSan(c, split(ex.moves || ex.line), m.id + ' example');
  if (mv && mv.length !== ex.notes.length) bad(m.id, `example notes ${ex.notes.length} vs plies ${mv.length}`);
  if (mv && !c.isCheckmate()) bad(m.id, 'example does not end in mate');
  for (const side of ['deliver', 'defend']) for (const [k, it] of m.practice[side].entries()) await checkItem(it, `${m.id} ${side}${k}`);
}
console.log(problems ? `\n${problems} PROBLEMS` : '\nALL GOOD');
proc.kill();
