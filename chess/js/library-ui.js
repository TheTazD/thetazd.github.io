// Pillar 5 screens: the library shelves, an entry (step through it, read the
// ideas, launch practice for both sides) and the "play the line" drill.
import { Board } from './board.js';
import { engine } from './engine.js';
import { store } from './store.js';
import { explainMove } from './explain.js';
import { loadProgress, saveProgress } from './puzzles.js';
import { Chess, playUci, sanOf, scoreFor, toWhitePov, winPct, COLOR_NAME } from './chessutil.js';
import {
  OPENINGS, MATES, entry, mainLine, trapLine, numbered, authoredPuzzles,
  openingsFromGames, libState, markSeen, recordDrill, entryStatus,
} from './library.js';

let C; // { app, $, esc, topbar, go, toast, profile() }
export function initLibrary(ctx) { C = ctx; }
const esc = (s) => C.esc(s);

const MATE_ICON = { 'back-rank': '♜', scholars: '♛', fools: '♛', smothered: '♞', anastasia: '♞', arabian: '♜', boden: '♝', legal: '♝' };
const icon = (e) => (e.type === 'opening' ? (e.side === 'w' ? '♘' : '♞') : MATE_ICON[e.id] || '#');

async function myOpenings() {
  const games = await store.listGames(C.profile().id);
  return openingsFromGames(games);
}

function pills(p, e) {
  return entryStatus(p, e).map((x) => `<span class="state ${x.ok ? 'strong' : 'learning'}">${esc(x.text)}</span>`).join('');
}

function row(p, e, sub) {
  return `<a class="theme-row lib-row" href="#/library/${e.id}">
    <span class="theme-ico">${icon(e)}</span>
    <span class="theme-main"><b>${esc(e.name)}</b><small>${esc(sub || e.blurb)}</small>
      <span class="lib-pills">${pills(p, e)}</span></span>
    <span class="pz-row-go">›</span>
  </a>`;
}

// Home screen card
export async function homeLibraryCard() {
  const mine = await myOpenings().catch(() => []);
  const top = mine[0];
  const sub = top
    ? `You meet the ${entry(top.id).name} most often — ${top.played + top.faced} of your games. Brush up on it.`
    : 'Openings and checkmate patterns, step by step, with practice for both sides.';
  return `<section>
    <h2 class="section-title">Library</h2>
    <div class="card pz-home">
      <div class="pz-home-text"><b>Learn something new</b><small>${esc(sub)}</small></div>
      <div class="actions">
        ${top ? `<a class="btn primary" href="#/library/${top.id}">${esc(entry(top.id).name)}</a>` : ''}
        <a class="btn ${top ? '' : 'primary'}" href="#/library">Open the library</a>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------
export async function renderLibrary() {
  const p = await loadProgress(C.profile().id);
  const mine = await myOpenings().catch(() => []);
  const byId = Object.fromEntries(mine.map((m) => [m.id, m]));
  const seenSub = (o) => {
    const m = byId[o.id];
    if (!m) return o.blurb;
    const bits = [];
    if (m.played) bits.push(`you played it ${m.played}×`);
    if (m.faced) bits.push(`you faced it ${m.faced}×`);
    return `In your games: ${bits.join(', ')}.`;
  };
  const white = OPENINGS.filter((o) => o.side === 'w').map((o) => entry(o.id));
  const black = OPENINGS.filter((o) => o.side === 'b').map((o) => entry(o.id));
  C.app.innerHTML = `${C.topbar('Library')}
  <main class="page narrow">
    <p class="hint lib-intro">A place to learn rather than be tested. Open any entry to step through it move by move, then practise it from both sides.</p>
    ${mine.length ? `<h2 class="section-title">From your games</h2>
      <div class="theme-list">${mine.slice(0, 3).map((m) => row(p, entry(m.id), seenSub(entry(m.id)))).join('')}</div>` : ''}
    <details class="shelf" open>
      <summary><span class="shelf-ico">♘</span><span><b>Openings</b><small>${OPENINGS.length} sound openings for your level, with their ideas and traps</small></span></summary>
      <h3 class="shelf-sub">Openings for White</h3>
      <div class="theme-list">${white.map((o) => row(p, o, seenSub(o))).join('')}</div>
      <h3 class="shelf-sub">Defences for Black</h3>
      <div class="theme-list">${black.map((o) => row(p, o, seenSub(o))).join('')}</div>
      ${mine.length ? '' : '<p class="hint">Review a few games and this shelf will show which openings you actually play and meet.</p>'}
    </details>
    <details class="shelf" open>
      <summary><span class="shelf-ico">#</span><span><b>Checkmate patterns</b><small>${MATES.length} named mates — learn to deliver them and to see them coming</small></span></summary>
      <div class="theme-list">${MATES.map((m) => row(p, entry(m.id))).join('')}</div>
    </details>
    <details class="shelf">
      <summary><span class="shelf-ico">♝</span><span><b>Tactical motifs</b><small>Forks, pins, skewers and more</small></span></summary>
      <p class="hint">Each puzzle theme has its own "how it works" page with practice sets.</p>
      <div class="actions"><a class="btn" href="#/puzzles">Go to Puzzles</a></div>
    </details>
    <p class="hint center">More shelves (endgame techniques) to come.</p>
  </main>`;
}

// ---------------------------------------------------------------------------
// An entry
// ---------------------------------------------------------------------------
export async function renderEntry(id) {
  const e = entry(id);
  if (!e) return C.go('library');
  const p = await loadProgress(C.profile().id);
  const L = libState(p);
  const firstVisit = !L.seen[id];
  markSeen(p, id);
  saveProgress(p).catch((err) => console.warn(err));
  const mine = e.type === 'opening' ? (await myOpenings().catch(() => [])).find((m) => m.id === id) : null;

  const lines = { main: mainLine(e) };
  if (e.type === 'opening' && e.trap) lines.trap = trapLine(e);
  const S = { which: 'main', i: 0, layer: 0, ex: {} };
  const orient = e.type === 'opening' ? e.side : lines.main.fen.split(' ')[1];

  C.app.innerHTML = `${C.topbar(e.name, '#/library')}
  <main class="page review-layout">
    <div class="board-col">
      <div id="board"></div>
      <div class="nav-row" id="nav">
        <button class="nbtn" data-a="first" aria-label="Start">⏮</button>
        <button class="nbtn" data-a="prev" aria-label="Previous move">◀</button>
        <button class="nbtn" data-a="next" aria-label="Next move">▶</button>
        <button class="nbtn" data-a="flip" aria-label="Flip board">⇅</button>
      </div>
    </div>
    <div class="side-col">
      <div class="card lib-head">
        <p class="eyebrow">${e.type === 'opening' ? (e.side === 'w' ? 'Opening · for White' : 'Defence · for Black') : 'Checkmate pattern'}</p>
        <h2 class="card-title">${esc(e.name)}</h2>
        <p class="lib-blurb">${esc(e.blurb)}</p>
        ${mine ? `<p class="hint lib-mine">In your games: ${[mine.played ? `played ${mine.played}×` : '', mine.faced ? `faced ${mine.faced}×` : ''].filter(Boolean).join(', ')}. <a href="#/game/${mine.games[0]}">Open the latest ›</a></p>` : ''}
        ${lines.trap ? `<div class="seg" id="seg"><button data-w="main" class="on">Main line</button><button data-w="trap">The trap</button></div>` : ''}
      </div>
      <div id="movelist" class="line-moves lib-moves"></div>
      <div id="note" class="panel"></div>
      ${deeper(e)}
      ${practiceCard(p, e)}
    </div>
  </main>`;

  const board = new Board(C.$('#board'), { orientation: orient });

  function line() { return lines[S.which]; }

  function draw() {
    const l = line();
    const st = S.i ? l.steps[S.i - 1] : null;
    board.set({ fen: st ? st.fen : l.fen, lastMove: st ? { from: st.move.from, to: st.move.to } : null, arrows: [], marks: {}, movable: null });
    const startMove = +l.fen.split(' ')[5];
    const blackFirst = l.fen.split(' ')[1] === 'b';
    C.$('#movelist').innerHTML = l.steps.map((s, k) => {
      const ply = k + (blackFirst ? 1 : 0);
      const num = s.move.color === 'w' ? `<span class="mnum">${startMove + Math.floor(ply / 2)}.</span>` : k === 0 ? `<span class="mnum">${startMove + Math.floor(ply / 2)}…</span>` : '';
      return `${num}<button class="mchip ${k + 1 === S.i ? 'cur' : ''}" data-i="${k + 1}">${esc(s.san)}</button>`;
    }).join('');
    C.$('#movelist').onclick = (ev) => { const b = ev.target.closest('[data-i]'); if (b) setI(+b.dataset.i); };
    C.$('#movelist .cur')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    drawNote();
  }

  function intro() {
    if (S.which === 'trap') return `<p class="why">${esc(e.trap.name)}</p><p>${esc(e.trap.from)}</p><p class="hint">Tap ▶ to step through it.</p>`;
    if (e.type === 'opening') return `<p>${firstVisit ? 'New to this one? ' : ''}Step through the main line with ▶. Every move has a short note on what it does and why.</p><p class="hint">${esc(numbered(lines.main))}</p>`;
    return `<p>${esc(e.how)}</p><p class="hint">Tap ▶ to see it happen.</p>`;
  }

  function drawNote() {
    const el = C.$('#note');
    const l = line();
    if (!S.i) { el.innerHTML = `<div class="card move-card">${intro()}</div>`; return; }
    const st = l.steps[S.i - 1];
    const ex = S.ex[S.which + S.i];
    const last = S.i === l.steps.length;
    let body = `<div class="move-head"><span class="mnum">${moveNo(l, S.i - 1)}</span><b class="msan">${esc(st.san)}</b><span class="who">${COLOR_NAME[st.move.color]}</span></div>
      <p class="why">${esc(st.text)}</p>`;
    if (S.layer >= 1) body += ex ? `<div class="more"><p>${esc(ex.why)}</p>${ex.more.slice(0, 2).map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : '<div class="thinking">Asking the engine…</div>';
    if (last) {
      if (S.which === 'trap') body += `<p class="lesson"><b>The lesson:</b> ${esc(e.trap.lesson)}</p>`;
      else if (e.type === 'mate') body += `<p class="lesson"><b>Defending against it:</b> ${esc(e.defend)}</p>`;
      else body += `<p class="lesson">That's the main line. Read the ideas below, then practise it.</p>`;
    }
    body += `<div class="actions"><button class="btn primary" data-act="next">${last ? 'Start again' : 'Next move ▶'}</button>${S.layer === 0 ? '<button class="btn" data-act="engine">Tell me more</button>' : ''}</div>`;
    el.innerHTML = `<div class="card move-card">${body}</div>`;
    el.onclick = onNote;
  }

  async function onNote(ev) {
    const a = ev.target.closest('[data-act]')?.dataset.act;
    if (a === 'next') return setI(S.i >= line().steps.length ? 0 : S.i + 1);
    if (a === 'engine') {
      const key = S.which + S.i;
      const i = S.i;
      S.layer = 1;
      drawNote();
      if (!S.ex[key]) {
        const l = line();
        const st = l.steps[i - 1];
        const before = i > 1 ? l.steps[i - 2].fen : l.fen;
        try {
          S.ex[key] = await explainMove({ fenBefore: before, playedUci: st.uci, hero: st.move.color, ply: i, history: [] });
        } catch (err) {
          if (err.message !== 'cancelled') C.toast('The engine had a problem. Try again.');
          S.layer = 0;
        }
      }
      if (S.i === i && S.which + i === key) drawNote();
    }
  }

  function setI(i) {
    S.i = Math.max(0, Math.min(line().steps.length, i));
    S.layer = 0;
    engine.clearQueue();
    draw();
  }

  C.$('#nav').onclick = (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'flip') return board.flip();
    if (a === 'first') setI(0);
    if (a === 'prev') setI(S.i - 1);
    if (a === 'next') setI(S.i + 1);
  };
  let sx = null;
  C.$('#board').addEventListener('touchstart', (ev) => { sx = ev.touches[0].clientX; }, { passive: true });
  C.$('#board').addEventListener('touchend', (ev) => {
    if (sx === null) return;
    const dx = ev.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) setI(S.i + (dx < 0 ? 1 : -1));
  });
  document.onkeydown = (ev) => {
    if (!C.$('#nav')) return;
    if (ev.key === 'ArrowRight') setI(S.i + 1);
    if (ev.key === 'ArrowLeft') setI(S.i - 1);
  };
  C.$('#seg')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-w]');
    if (!b) return;
    S.which = b.dataset.w;
    C.$('#seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    setI(S.which === 'trap' ? firstTrapNote(lines.trap) : 0);
  });
  draw();
}

function moveNo(l, k) {
  const startMove = +l.fen.split(' ')[5];
  const ply = k + (l.fen.split(' ')[1] === 'b' ? 1 : 0);
  return `${startMove + Math.floor(ply / 2)}${l.steps[k].move.color === 'w' ? '.' : '…'}`;
}

// Jump straight to where the trap line leaves normal opening moves.
function firstTrapNote(l) {
  const k = l.steps.findIndex((s) => !s.text.startsWith('The usual opening moves'));
  return Math.max(0, k + 1);
}

function deeper(e) {
  if (e.type === 'opening') {
    return `<details class="card lib-deeper"><summary><b>Ideas and plans</b><small>What each side is aiming for</small></summary>
      ${e.plan.map((x) => `<p>${esc(x)}</p>`).join('')}
      <p class="eyebrow">Watch out for</p>
      <ul>${e.watch.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </details>`;
  }
  return `<details class="card lib-deeper" open><summary><b>How to spot it</b><small>And how to stop it</small></summary>
    <ul>${e.spot.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="eyebrow">Defending against it</p>
    <p>${esc(e.defend)}</p>
  </details>`;
}

function sideToMove(e, side) {
  const it = authoredPuzzles(e, side)[0];
  if (!it) return null;
  const turn = it.p.last ? new Chess(it.p.fen).turn() === 'w' ? 'b' : 'w' : it.p.fen.split(' ')[1];
  // Threat drills are played by the side that is NOT to move in the stored position.
  return it.kind === 'threat' ? (turn === 'w' ? 'b' : 'w') : turn;
}

function practiceCard(p, e) {
  const L = libState(p);
  const prac = (s) => L.prac[`${e.id}:${s}`];
  const drill = (c) => L.drill[`${e.id}:${c}`];
  const stat = (d, kind) => {
    if (!d) return 'Not tried yet';
    if (kind === 'drill') return `Best ${d.best}% · ${d.runs} run${d.runs === 1 ? '' : 's'}`;
    return `${d.n ? Math.round((d.ok / d.n) * 100) : 0}% first time · ${d.sets} set${d.sets === 1 ? '' : 's'}`;
  };
  const btn = (href, title, sub, st) => `<a class="prac-btn" href="${href}"><b>${esc(title)}</b><small>${esc(sub)}</small><span class="prac-stat">${esc(st)}</span></a>`;
  let html = '';
  if (e.type === 'opening') {
    const mineFirst = e.side === 'w' ? ['w', 'b'] : ['b', 'w'];
    html += `<p class="eyebrow">Know the moves</p><div class="prac-grid">${mineFirst.map((c) => btn(
      `#/library/${e.id}/drill/${c}`,
      `Play it as ${COLOR_NAME[c]}`,
      c === e.side ? 'You play the opening; find each move from memory' : 'You face it; find the right replies',
      stat(drill(c), 'drill'),
    )).join('')}</div>`;
    if (e.trap) {
      const dSide = sideToMove(e, 'deliver');
      const vSide = sideToMove(e, 'defend');
      html += `<p class="eyebrow">The trap: ${esc(e.trap.name)}</p><div class="prac-grid">
        ${btn(`#/puzzles/play/lib~${e.id}~deliver`, 'Spring the trap', `As ${COLOR_NAME[dSide] || 'the attacker'}: punish the mistake`, stat(prac('deliver')))}
        ${btn(`#/puzzles/play/lib~${e.id}~defend`, 'Avoid the trap', `As ${COLOR_NAME[vSide] || 'the defender'}: don't fall for it`, stat(prac('defend')))}
      </div>`;
    }
  } else {
    html += `<div class="prac-grid">
      ${btn(`#/puzzles/play/lib~${e.id}~deliver`, 'Deliver it', 'Find the mate in positions like this', stat(prac('deliver')))}
      ${btn(`#/puzzles/play/lib~${e.id}~defend`, 'Defend against it', 'Spot the mate coming, then stop it', stat(prac('defend')))}
    </div>`;
  }
  return `<section class="card lib-practice"><h3 class="card-title">Practise it</h3>${html}</section>`;
}

// ---------------------------------------------------------------------------
// Play the line from memory
// ---------------------------------------------------------------------------
export async function renderDrill(id, color) {
  const e = entry(id);
  if (!e || e.type !== 'opening' || !['w', 'b'].includes(color)) return C.go('library');
  const p = await loadProgress(C.profile().id);
  const line = mainLine(e);
  const S = { i: 0, mine: 0, exact: 0, playable: 0, missed: [], tries: 0, wrongEx: null, layer: 0, busy: false };
  const myPlies = line.steps.filter((s) => s.move.color === color).length;

  C.app.innerHTML = `${C.topbar(`${e.name} · as ${COLOR_NAME[color]}`, `#/library/${id}`)}
  <main class="page review-layout pz-layout">
    <div class="board-col">
      <div class="pz-dots" id="dots"></div>
      <div id="board"></div>
      <div class="player-strip" id="turn"></div>
    </div>
    <div class="side-col"><div id="panel" class="panel"></div></div>
  </main>`;
  const board = new Board(C.$('#board'), { orientation: color, onMove: (u) => onMove(u) });
  const alive = () => document.body.contains(board.el);

  function dots() {
    const mineSteps = line.steps.map((s, k) => ({ s, k })).filter((x) => x.s.move.color === color);
    C.$('#dots').innerHTML = mineSteps.map(({ k }) => {
      const r = S.res && S.res[k];
      return `<span class="dot ${r === 'ok' ? 'ok' : r === 'miss' ? 'miss' : r === 'alt' ? 'alt' : k === S.i ? 'cur' : ''}"></span>`;
    }).join('');
  }
  S.res = {};

  function panel(html, cls = '') { C.$('#panel').innerHTML = `<div class="card move-card ${cls}">${html}</div>`; }
  function fenAt(i) { return i ? line.steps[i - 1].fen : line.fen; }
  function head() { return `<div class="move-head"><span class="who">Move ${Math.min(S.mine + 1, myPlies)} of ${myPlies}</span><b>Play the line</b></div>`; }

  // Advance through the line: play the opponent's moves, stop at ours.
  function advance(prevNote) {
    if (!alive()) return;
    dots();
    if (S.i >= line.steps.length) return finish();
    const st = line.steps[S.i];
    if (st.move.color !== color) {
      board.set({ movable: null });
      if (prevNote) panel(`${head()}${prevNote}`);
      setTimeout(() => {
        if (!alive()) return;
        S.i++;
        board.set({ fen: st.fen, lastMove: { from: st.move.from, to: st.move.to }, movable: null });
        advance(`${prevNote || ''}<p class="why"><b>${esc(st.san)}</b> — ${esc(st.text)}</p>`);
      }, S.i === 0 ? 400 : 650);
      return;
    }
    S.tries = 0;
    S.wrongEx = null;
    S.layer = 0;
    board.set({ fen: fenAt(S.i), movable: color });
    C.$('#turn').textContent = `${COLOR_NAME[color]} to move`;
    panel(`${head()}${prevNote || ''}<p class="hint">Your move: what does the ${esc(e.name)} play here?</p>
      <div class="actions"><button class="btn ghost" data-act="show">Show me</button></div>`);
    C.$('#panel').onclick = onPanel;
  }

  async function onMove(uci) {
    if (S.busy) return;
    const st = line.steps[S.i];
    const fen = fenAt(S.i);
    const c = new Chess(fen);
    const m = playUci(c, uci);
    if (!m) return;
    board.set({ fen: c.fen(), lastMove: { from: m.from, to: m.to }, movable: null });
    if (uci === st.uci) return good('ok', `<span class="ok">✓ ${esc(st.san)}</span>`);
    // Not the book move: is it still a sensible move?
    S.busy = true;
    panel(`${head()}<div class="thinking">Checking ${esc(m.san)}…</div>`);
    let alt = 0, book = 100;
    try {
      [alt, book] = [await score(fen, uci), await score(fen, st.uci)];
    } catch (err) { S.busy = false; if (err.message === 'cancelled') return; }
    S.busy = false;
    if (!alive()) return;
    if (alt >= book - 5) {
      // Playable, but not this line: show the book move and carry on.
      board.set({ fen: st.fen, lastMove: { from: st.move.from, to: st.move.to }, arrows: [{ from: m.from, to: m.to, kind: 'played' }] });
      return good(S.tries ? 'miss' : 'alt', `<span class="ok">${esc(m.san)} is playable</span>, but this line goes <b>${esc(st.san)}</b>.`);
    }
    S.tries++;
    S.lastWrong = { uci, san: m.san, fen };
    S.wrongEx = null;
    S.layer = 0;
    wrongPanel();
  }

  async function score(fen, uci) {
    const r = await engine.analyse(fen, { depth: 12, searchmoves: [uci] });
    const l = r.lines[0];
    return l ? winPct(scoreFor(toWhitePov(l, fen), color)) : 50;
  }

  function wrongPanel() {
    const w = S.lastWrong;
    let body = `<p class="why"><span class="miss">✗ ${esc(w.san)}</span> isn't the move here.</p>`;
    if (S.layer >= 1) body += S.wrongEx ? `<p>${esc(S.wrongEx.why)}</p>` : '<div class="thinking">Looking at what goes wrong…</div>';
    body += `<div class="actions"><button class="btn primary" data-act="retry">Try again</button>
      ${S.layer === 0 ? '<button class="btn" data-act="why">Why not?</button>' : ''}
      <button class="btn ghost" data-act="show">Show me</button></div>`;
    panel(`${head()}${body}`, 'bad');
    C.$('#panel').onclick = onPanel;
  }

  function good(kind, lead) {
    const st = line.steps[S.i];
    const result = S.tries && kind === 'ok' ? 'miss' : kind;
    S.res[S.i] = result;
    if (result === 'ok') S.exact++;
    else if (result === 'alt') S.playable++;
    else S.missed.push(st.san);
    S.mine++;
    S.i++;
    board.set({ fen: st.fen, lastMove: { from: st.move.from, to: st.move.to }, movable: null });
    advance(`<p class="why">${lead}</p><p>${esc(st.text)}</p>`);
  }

  async function onPanel(ev) {
    const a = ev.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    if (a === 'retry') {
      board.set({ fen: fenAt(S.i), lastMove: null, arrows: [], movable: color });
      panel(`${head()}<p class="hint">Have another look.</p><div class="actions"><button class="btn ghost" data-act="show">Show me</button></div>`);
      return;
    }
    if (a === 'show') {
      const st = line.steps[S.i];
      S.tries++;
      board.set({ fen: fenAt(S.i), arrows: [{ from: st.move.from, to: st.move.to, kind: 'best' }], movable: null });
      setTimeout(() => alive() && good('miss', `The move is <b>${esc(st.san)}</b>.`), 900);
      return;
    }
    if (a === 'why') {
      S.layer = 1;
      wrongPanel();
      const w = S.lastWrong;
      try {
        const ex = await explainMove({ fenBefore: w.fen, playedUci: w.uci, hero: color, ply: S.i + 1, history: [] });
        if (S.lastWrong === w) { S.wrongEx = ex; wrongPanel(); }
      } catch (err) { if (err.message !== 'cancelled') C.toast('The engine had a problem. Try again.'); }
    }
  }

  async function finish() {
    const d = recordDrill(p, id, color, S.exact, myPlies);
    try { await saveProgress(p); } catch (err) { console.warn(err); }
    const known = S.exact + S.playable;
    const msg = S.exact === myPlies ? 'Every move from memory. You know this line.'
      : known >= myPlies - 1 ? 'Nearly there.'
      : 'Good start — run it again and it\'ll stick.';
    C.$('#turn').textContent = '';
    panel(`<div class="pz-done"><div class="pz-score">${S.exact}<small>/${myPlies}</small></div>
      <p class="why">${msg}</p>
      ${S.playable ? `<p class="hint">${S.playable} move${S.playable === 1 ? ' was' : 's were'} playable but not the main line.</p>` : ''}
      ${S.missed.length ? `<p class="hint">Moves to remember: <b>${S.missed.map(esc).join(', ')}</b></p>` : ''}
      <p class="hint">Best so far: ${d.best}%</p></div>
      <div class="actions"><a class="btn primary" href="#/library/${id}/drill/${color}?again=${Date.now()}">Again</a>
      <a class="btn" href="#/library/${id}/drill/${color === 'w' ? 'b' : 'w'}">Play it as ${COLOR_NAME[color === 'w' ? 'b' : 'w']}</a>
      <a class="btn ghost" href="#/library/${id}">Back</a></div>`, 'good');
  }

  board.set({ fen: line.fen, movable: null });
  advance('');
}
