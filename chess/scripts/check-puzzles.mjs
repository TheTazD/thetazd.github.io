// Checks the bundled puzzle files: every puzzle's last move and solution must be
// legal from its position, ids unique, ratings present. Run from chess/:
//   node scripts/check-puzzles.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { Chess } from '../vendor/chess.js';

const dir = new URL('../data/', import.meta.url);
const sets = {};
const pack = JSON.parse(readFileSync(new URL('puzzles.json', dir)));
for (const [t, list] of Object.entries(pack.themes)) sets['puzzles.json:' + t] = list;
for (const f of readdirSync(new URL('themes/', dir))) {
  if (!f.endsWith('.json')) continue;
  sets['themes/' + f] = JSON.parse(readFileSync(new URL('themes/' + f, dir))).puzzles;
}

const ids = new Set();
let bad = 0, total = 0;
const play = (c, u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
for (const [name, list] of Object.entries(sets)) {
  for (const p of list) {
    total++;
    try {
      if (ids.has(p.id)) throw new Error('duplicate id');
      ids.add(p.id);
      if (!(p.r > 0)) throw new Error('no rating');
      const c = new Chess(p.fen);
      play(c, p.last);
      for (const u of p.sol) play(c, u);
    } catch (e) {
      bad++;
      console.log(`${name} ${p.id}: ${e.message}`);
    }
  }
  const r = list.map((x) => x.r).sort((a, b) => a - b);
  console.log(`${name.padEnd(32)} ${String(list.length).padStart(3)} puzzles, rated ${r[0]}–${r.at(-1)}`);
}
console.log(bad ? `${bad} of ${total} puzzles have problems` : `All ${total} puzzles OK`);
process.exit(bad ? 1 : 0);
