// Pillar 2 screens: puzzle hub, theme pages, and the puzzle session itself.
import { Board } from './board.js';
import { engine } from './engine.js';
import { store, newId } from './store.js';
import { explainMove } from './explain.js';
import { gameLine } from './analysis.js';
import { Chess, playUci, sanOf, toWhitePov, scoreFor, winPct, nullMoveFen, other, COLOR_NAME } from './chessutil.js';
import {
  THEMES, THEME, LEVELS, SET_SIZE, loadProgress, saveProgress, streakInfo, themeState, duePuzzles, dueThemes,
  recordResult, finishSet, buildThemeSet, buildDailySet, startFen, dayKey,
} from './puzzles.js';
import { explainSolution } from './puzzle-explain.js';
import { themeName } from './themes.js';

let C; // context from app.js: { app, $, esc, topbar, go, toast, profile() }
export function initPuzzles(ctx) { C = ctx; }

const esc = (s) => C.esc(s);

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------
function flame(n) {
  return `<span class="streak ${n ? 'on' : ''}" title="Daily streak"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1c.5 2.6 3.8 4.2 3.8 8A3.8 3.8 0 0 1 8 15a3.8 3.8 0 0 1-3.8-4.4c.2-1.5 1-2.4 1.7-3 .1 1.2.6 2 1.4 2.3C7 7.6 6.8 4 8 1z"/></svg>${n}</span>`;
}

export async function homePuzzleCard() {
  const p = await loadProgress(C.profile().id);
  const s = streakInfo(p);
  const due = duePuzzles(p).length + dueThemes(p).length;
  let sub;
  if (!p.rating) sub = 'Short themed sets — forks, pins, mates and more.';
  else if (s.doneToday) sub = `Done for today — ${s.todayCount} puzzle${s.todayCount === 1 ? '' : 's'}. More is always welcome.`;
  else if (s.current) sub = `Do today's set to keep your ${s.current}-day streak going.`;
  else sub = due ? `${due} thing${due === 1 ? '' : 's'} due for a re-test.` : 'One set a day builds the habit.';
  return `<section>
    <h2 class="section-title">Puzzles ${p.rating ? flame(s.current) : ''}</h2>
    <div class="card pz-home">
      <div class="pz-home-text"><b>${p.rating ? "Today's practice" : 'Start puzzles'}</b><small>${esc(sub)}</small></div>
      <div class="actions">
        <a class="btn primary" href="#/puzzles/play/daily">${s.doneToday ? 'Another set' : 'Start'}</a>
        <a class="btn" href="#/puzzles">All themes</a>
      </div>
    </div>
  </section>`;
}

async function puzzleHistory(themeId = null, limit = 15) {
  const all = await store.listGames(C.profile().id);
  return all.filter((g) => g.source === 'puzzle' && g.puzzle && (!themeId || g.puzzle.theme === themeId)).slice(0, limit);
}

function historyList(items) {
  if (!items.length) return `<div class="empty">Your puzzle attempts will appear here, so you can go back over any you missed.</div>`;
  return `<div class="pz-history">${items.map((g) => {
    const z = g.puzzle;
    const ok = z.firstTry;
    const label = z.kind === 'threat' ? 'Spot the threat' : 'Find the move';
    return `<a class="pz-row" href="#/game/${g.id}">
      <span class="pz-mark ${ok ? 'ok' : 'miss'}">${ok ? '✓' : '✗'}</span>
      <span class="pz-row-main"><b>${esc(themeName(z.theme))}</b><small>${label}${z.review ? ' · re-test' : ''} · ${esc(g.date || '')}</small></span>
      <span class="pz-row-go">Review ›</span>
    </a>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Level question (first visit for each player)
// ---------------------------------------------------------------------------
async function ensureLevel(p, next) {
  if (p.rating) return true;
  C.app.innerHTML = `${C.topbar('Puzzles')}
  <main class="page narrow">
    <div class="card">
      <h2 class="card-title">How strong is ${esc(C.profile().name)}?</h2>
      <p class="hint">This sets where the puzzles start. It adjusts by itself as you solve them, so a rough guess is fine.</p>
      <div class="level-list">${LEVELS.map((l) => `<button class="level-btn" data-r="${l.rating}"><b>${esc(l.label)}</b><small>starts around ${l.rating}</small></button>`).join('')}</div>
    </div>
  </main>`;
  C.app.querySelectorAll('.level-btn').forEach((b) => (b.onclick = async () => {
    p.rating = +b.dataset.r;
    await saveProgress(p);
    next();
  }));
  return false;
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------
export async function renderPuzzleHub() {
  const p = await loadProgress(C.profile().id);
  if (!(await ensureLevel(p, renderPuzzleHub))) return;
  const s = streakInfo(p);
  const due = duePuzzles(p).length;
  const fading = dueThemes(p);
  const history = await puzzleHistory();
  C.app.innerHTML = `${C.topbar('Puzzles')}
  <main class="page narrow">
    <div class="card pz-stats">
      <div><span class="big">${p.rating}</span><small>puzzle rating</small></div>
      <div><span class="big">${flame(s.current)}</span><small>${s.current === 1 ? 'day' : 'days'} in a row${s.best > s.current ? ` · best ${s.best}` : ''}</small></div>
      <div><span class="big">${s.todayCount}</span><small>today</small></div>
    </div>
    <a class="card pz-daily" href="#/puzzles/play/daily">
      <span class="pz-daily-ico">★</span>
      <span><b>Today's practice</b><small>${due || fading.length ? `Includes ${[due ? `${due} puzzle${due === 1 ? '' : 's'} you missed before` : '', fading.length ? `a refresher on ${fading.map(themeName).join(', ')}` : ''].filter(Boolean).join(' and ')}.` : 'A mixed set aimed at what needs the most work.'}</small></span>
      <span class="pz-row-go">›</span>
    </a>
    <h2 class="section-title">Themes</h2>
    <div class="theme-list">${THEMES.map((t) => {
      const st = themeState(p, t.id);
      return `<a class="theme-row" href="#/puzzles/theme/${t.id}">
        <span class="theme-ico">${t.icon}</span>
        <span class="theme-main"><b>${esc(t.name)}</b><small>${esc(t.blurb)}</small>
          ${st.key !== 'new' ? `<span class="meter"><span style="width:${st.pct}%"></span></span>` : ''}</span>
        <span class="state ${st.key}">${esc(st.label)}</span>
      </a>`;
    }).join('')}</div>
    <h2 class="section-title">Recent attempts</h2>
    ${historyList(history)}
    <p class="hint center">Puzzles from the Lichess puzzle database (free to use, CC0).</p>
  </main>`;
}

export async function renderThemeIntro(id) {
  const t = THEME[id];
  if (!t) return C.go('puzzles');
  const p = await loadProgress(C.profile().id);
  if (!(await ensureLevel(p, () => renderThemeIntro(id)))) return;
  const st = themeState(p, id);
  const ts = p.themes[id];
  const history = await puzzleHistory(id, 10);
  C.app.innerHTML = `${C.topbar(t.name, '#/puzzles')}
  <main class="page narrow">
    <div class="card theme-intro">
      <div class="theme-head"><span class="theme-ico big">${t.icon}</span><div><h2 class="card-title">${esc(t.name)}</h2><span class="state ${st.key}">${esc(st.label)}</span></div></div>
      <p>${esc(t.concept)}</p>
      ${ts ? `<p class="hint">${ts.attempts} tried · ${ts.solved} solved first time${ts.strong && ts.due ? ` · next refresher ${new Date(ts.due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</p>` : ''}
      <a class="btn primary wide" href="#/puzzles/play/${id}">Start a set of ${SET_SIZE}</a>
    </div>
    <h2 class="section-title">Your attempts</h2>
    ${historyList(history)}
  </main>`;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export async function renderSession(mode) {
  const profile = C.profile();
  const p = await loadProgress(profile.id);
  if (!(await ensureLevel(p, () => renderSession(mode)))) return;
  const title = mode === 'daily' ? "Today's practice" : themeName(mode);
  C.app.innerHTML = `${C.topbar(title, mode === 'daily' ? '#/puzzles' : `#/puzzles/theme/${mode}`)}
  <main class="page narrow"><div class="card"><div class="thinking">Picking puzzles at your level…</div></div></main>`;
  let set;
  try {
    set = mode === 'daily' ? await buildDailySet(p) : await buildThemeSet(p, mode);
  } catch (e) {
    console.error(e);
    C.app.querySelector('main').innerHTML = `<div class="card error"><p>Couldn't load puzzles: ${esc(e.message)}</p><a class="btn" href="#/puzzles">Back</a></div>`;
    return;
  }
  if (!set.items.length) {
    C.app.querySelector('main').innerHTML = `<div class="empty">Couldn't get puzzles for this theme just now — they come from Lichess, which may be busy. Try again in a few minutes, or pick another theme.</div><div class="actions"><a class="btn" href="#/puzzles">All themes</a></div>`;
    return;
  }

  C.app.innerHTML = `${C.topbar(title, mode === 'daily' ? '#/puzzles' : `#/puzzles/theme/${mode}`)}
  <main class="page review-layout pz-layout">
    <div class="board-col">
      <div class="pz-dots" id="dots"></div>
      <div id="board"></div>
      <div class="player-strip" id="turn"></div>
    </div>
    <div class="side-col"><div id="panel" class="panel"></div></div>
  </main>`;
  const $ = (s) => C.app.querySelector(s);
  const board = new Board($('#board'), { onMove: (uci) => onMove(uci) });
  const S = { set, i: -1, results: [], p, ratingStart: p.rating, timers: [] };
  const later = (fn, ms) => S.timers.push(setTimeout(() => { if (document.body.contains(board.el)) fn(); }, ms));

  function dots() {
    $('#dots').innerHTML = set.items.map((it, k) => {
      const r = S.results[k];
      const cls = r ? (r.firstTry ? 'ok' : 'miss') : k === S.i ? 'cur' : '';
      return `<span class="dot ${cls}" title="${it.kind === 'threat' ? 'Spot the threat' : 'Find the move'}"></span>`;
    }).join('');
  }

  function panel(html, cls = '') {
    $('#panel').innerHTML = `<div class="card move-card ${cls}">${html}</div>`;
  }

  function head(extra = '') {
    const it = S.item;
    const tag = it.kind === 'threat' ? 'Spot the threat' : 'Find the move';
    return `<div class="move-head"><span class="who">Puzzle ${S.i + 1} of ${set.items.length}</span><b>${tag}</b>${it.review ? '<span class="grade meh">Re-test</span>' : ''}${extra}</div>`;
  }

  function next() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    S.i++;
    if (S.i >= set.items.length) return finish();
    const it = set.items[S.i];
    const pz = it.p;
    const fen = startFen(pz);
    const solver = fen.split(' ')[1]; // side to move after the opponent's last move
    S.item = it;
    S.pz = pz;
    S.layer = 0;
    S.firstTry = true;
    S.wrong = null;
    S.lastWrong = null;
    S.wrongEx = null;
    S.gaveUp = false;
    S.defUci = null;
    S.defEx = null;
    S.line = null;
    if (it.kind === 'solve') {
      S.hero = solver;
      S.fen = fen;
      S.step = 0;
      S.played = [pz.last];
      S.phase = 'solve';
      board.setOrientation(S.hero);
      board.set({ fen: pz.fen, lastMove: null, arrows: [], marks: {}, movable: null });
      $('#turn').textContent = '';
      later(() => {
        board.set({ fen, lastMove: { from: pz.last.slice(0, 2), to: pz.last.slice(2, 4) }, movable: S.hero });
        $('#turn').textContent = `${COLOR_NAME[S.hero]} to move`;
      }, 550);
      const t = THEME[pz.theme];
      const ask = set.mode === 'theme' && t ? t.find : 'Find the best move.';
      panel(`${head()}<p class="why">${esc(ask)}</p><p class="hint">${COLOR_NAME[S.hero]} to move. ${it.review ? 'You missed this one before — have another go.' : 'Tap a piece, then where it goes.'}</p>
        <div class="actions"><button class="btn ghost" data-act="giveup">Show me the answer</button></div>`);
    } else {
      // Threat drill: the player is the side whose move it would be after a
      // "pass". First name the opponent's threat, then stop it.
      S.hero = other(solver);
      S.fen = fen; // opponent (solver) to move: used to tap their threat
      S.defFen = nullMoveFen(fen); // player to move: used to defend
      S.phase = 'spot';
      S.spotTries = 0;
      board.setOrientation(S.hero);
      board.set({ fen, lastMove: null, arrows: [], marks: {}, movable: solver });
      $('#turn').textContent = `You are ${COLOR_NAME[S.hero]}`;
      panel(`${head()}<p class="why">Your opponent is threatening something. What is it?</p>
        <p class="hint">You're ${COLOR_NAME[S.hero]}. Tap the move <b>your opponent</b> wants to play next.</p>
        <div class="actions"><button class="btn ghost" data-act="showthreat">I can't see it</button></div>`);
    }
    $('#panel').onclick = onPanel;
    dots();
    scrollTop();
  }

  function scrollTop() {
    const b = $('#board');
    if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Moves on the board ------------------------------------------------
  async function onMove(uci) {
    if (S.phase === 'solve') return solveMove(uci);
    if (S.phase === 'spot') return spotMove(uci);
    if (S.phase === 'defend') return defendMove(uci);
  }

  function isMate(fen, uci) {
    const c = new Chess(fen);
    const m = playUci(c, uci);
    return m && c.isCheckmate();
  }

  async function engineScore(fen, uci, mover) {
    const r = await engine.analyse(fen, { depth: 12, searchmoves: [uci] });
    const l = r.lines[0];
    return l ? winPct(scoreFor(toWhitePov(l, fen), mover)) : 50;
  }

  async function solveMove(uci) {
    const pz = S.pz;
    const want = pz.sol[S.step];
    const fen = S.fen;
    const c = new Chess(fen);
    const m = playUci(c, uci);
    if (!m) return;
    board.set({ fen: c.fen(), lastMove: { from: m.from, to: m.to }, movable: null, arrows: [] });
    if (uci === want || c.isCheckmate()) {
      if (!S.wrong) S.played.push(uci);
      S.fen = c.fen();
      const reply = pz.sol[S.step + 1];
      if (!reply || c.isCheckmate()) return solved();
      panel(`${head()}<p class="why"><span class="ok">✓ ${esc(m.san)}</span> Good. Keep going…</p>`, 'good');
      later(() => {
        const r = playUci(c, reply);
        if (!S.wrong) S.played.push(reply);
        S.fen = c.fen();
        S.step += 2;
        board.set({ fen: S.fen, lastMove: { from: r.from, to: r.to }, movable: S.hero });
        panel(`${head()}<p class="why">${esc(r.san)} — your move again.</p><p class="hint">Finish the job.</p>
          <div class="actions"><button class="btn ghost" data-act="giveup">Show me the answer</button></div>`, 'good');
      }, 500);
      return;
    }
    // Not the puzzle's move. Is it nearly as good anyway?
    panel(`${head()}<div class="thinking">Checking ${esc(m.san)}…</div>`);
    let alt = 0, best = 100;
    try {
      [alt, best] = [await engineScore(fen, uci, S.hero), await engineScore(fen, want, S.hero)];
    } catch (e) { if (e.message === 'cancelled') return; }
    if (S.phase !== 'solve') return;
    if (alt >= 90 || (alt >= 70 && alt >= best - 3)) {
      board.set({ fen, lastMove: null, movable: S.hero });
      panel(`${head()}<p class="why"><b>${esc(m.san)} isn't bad</b> — it keeps a big advantage. But there's a stronger, more direct move here. Have another look.</p>
        <div class="actions"><button class="btn ghost" data-act="giveup">Show me the answer</button></div>`, 'meh');
      return;
    }
    S.firstTry = false;
    if (!S.wrong) { S.wrong = { uci, san: m.san, fen }; S.played.push(uci); }
    S.lastWrong = { uci, san: m.san, fen };
    S.layer = 0;
    wrongPanel();
  }

  function wrongPanel() {
    const w = S.lastWrong;
    let body = `<p class="why"><span class="miss">✗ ${esc(w.san)}</span> isn't it.</p>`;
    if (S.layer >= 1) {
      const ex = S.wrongEx;
      if (!ex) body += `<div class="thinking">Looking at what goes wrong…</div>`;
      else {
        body += `<p>${esc(ex.why)}</p>`;
        if (S.layer >= 2) body += `<div class="more">${ex.more.map((x) => `<p>${esc(x)}</p>`).join('')}</div>${linesHtml(ex.lines.slice(0, 1), 'wl')}`;
      }
    }
    body += `<div class="actions">
      <button class="btn primary" data-act="retry">Try again</button>
      ${S.layer === 0 ? '<button class="btn" data-act="whynot">Why not?</button>' : S.layer === 1 && S.wrongEx ? '<button class="btn" data-act="whynot2">Tell me more</button>' : ''}
      <button class="btn ghost" data-act="giveup">Show me</button></div>`;
    panel(`${head()}${body}`, 'bad');
  }

  async function explainWrong() {
    const w = S.lastWrong;
    if (S.wrongEx && S.wrongEx.uci === w.uci) return;
    S.wrongEx = null;
    try {
      const ex = await explainMove({ fenBefore: w.fen, playedUci: w.uci, hero: S.hero, ply: 1, history: [] });
      if (S.lastWrong !== w) return;
      S.wrongEx = { ...ex, uci: w.uci };
      const reply = ex.lines.find((l) => l.fen !== w.fen);
      if (reply && reply.steps[0]) board.set({ arrows: [{ from: reply.steps[0].move.from, to: reply.steps[0].move.to, kind: 'threat' }] });
    } catch (e) {
      if (e.message !== 'cancelled') C.toast('The engine had a problem. Try again.');
    }
  }

  async function solved() {
    S.phase = 'done';
    board.set({ movable: null });
    const res = await record({ firstTry: S.firstTry });
    S.layer = 0;
    S.res = res;
    solvedPanel();
  }

  function solvedPanel() {
    const ex = explainSolution(S.pz, S.hero);
    S.ex = ex;
    const r = S.res;
    const delta = r.delta ? `<span class="grade ${r.delta > 0 ? 'good' : 'bad'}">${r.delta > 0 ? '+' : ''}${r.delta}</span>` : '';
    let body = S.firstTry
      ? `<p class="why"><span class="ok">✓ Solved!</span></p>`
      : S.gaveUp ? `<p class="why">Here's the answer: <b>${esc(ex.keySan)}</b>.</p><p class="hint">It'll come back in a day or so to check it's stuck.</p>`
        : `<p class="why"><span class="ok">✓ Got there.</span></p><p class="hint">Not first time, so it'll come back for a re-test.</p>`;
    if (S.layer >= 1 || S.gaveUp) body += `<p>${esc(ex.why)}</p>`;
    if (S.layer >= 2) body += `<div class="more">${ex.more.map((x) => `<p>${esc(x)}</p>`).join('')}</div>`;
    if (S.layer >= 1 || S.gaveUp) body += linesHtml([ex.line], 'sl');
    body += `<div class="actions"><button class="btn primary" data-act="next">${S.i + 1 < set.items.length ? 'Next puzzle' : 'Finish'} ›</button>
      ${S.layer === 0 && !S.gaveUp ? '<button class="btn" data-act="whyworks">Why does it work?</button>' : S.layer < 2 ? '<button class="btn" data-act="moresol">Tell me more</button>' : ''}</div>`;
    panel(`${head(delta)}${body}`, S.firstTry ? 'good' : 'meh');
    dots();
  }

  async function giveUp() {
    S.firstTry = false;
    S.gaveUp = true;
    S.phase = 'done';
    const pz = S.pz;
    const want = pz.sol[S.step];
    // S.fen is always the last correct position (wrong moves never advance it).
    board.set({ fen: S.fen, lastMove: null, movable: null, arrows: [{ from: want.slice(0, 2), to: want.slice(2, 4), kind: 'best' }] });
    S.res = await record({ firstTry: false });
    S.layer = 1;
    solvedPanel();
  }

  // ---- Threat drill ------------------------------------------------------
  async function spotMove(uci) {
    const pz = S.pz;
    const want = pz.sol[0];
    const c = new Chess(S.fen);
    const m = playUci(c, uci);
    if (!m) return;
    const them = other(S.hero);
    board.set({ fen: c.fen(), lastMove: { from: m.from, to: m.to }, movable: null });
    let ok = uci === want || c.isCheckmate();
    if (!ok) {
      panel(`${head()}<div class="thinking">Checking ${esc(m.san)}…</div>`);
      try {
        const [alt, best] = [await engineScore(S.fen, uci, them), await engineScore(S.fen, want, them)];
        ok = alt >= Math.min(best - 4, 88);
      } catch (e) { if (e.message === 'cancelled') return; }
    }
    if (S.phase !== 'spot') return;
    if (ok) return threatFound(uci === want ? null : m.san);
    S.spotTries++;
    S.firstTry = false;
    board.set({ fen: S.fen, lastMove: null, movable: them });
    panel(`${head()}<p class="why"><span class="miss">✗ ${esc(m.san)}</span> doesn't hurt you much. Look for something that attacks, checks or captures.</p>
      <p class="hint">Tap another move for your opponent.</p>
      <div class="actions"><button class="btn ghost" data-act="showthreat">Show me the threat</button></div>`, 'bad');
  }

  function threatFound(altSan, shown = false) {
    const ex = explainSolution(S.pz, S.hero, { me: false });
    S.threatEx = ex;
    const want = S.pz.sol[0];
    S.phase = 'threat-shown';
    board.set({ fen: S.defFen, lastMove: null, movable: null, arrows: [{ from: want.slice(0, 2), to: want.slice(2, 4), kind: 'threat' }] });
    const lead = shown ? `They're threatening <b>${esc(ex.keySan)}</b>.` : altSan ? `<span class="ok">✓ ${esc(altSan)} would work for them</span> — and their strongest is <b>${esc(ex.keySan)}</b>.` : `<span class="ok">✓ Yes — ${esc(ex.keySan)}.</span>`;
    panel(`${head()}<p class="why">${lead}</p><p>${esc(ex.why)}</p>${linesHtml([ex.line], 'tl')}
      <div class="actions"><button class="btn primary" data-act="defend">Now stop it</button></div>`, shown ? 'meh' : 'good');
  }

  function startDefend() {
    S.phase = 'defend';
    S.defTries = 0;
    S.line = null;
    const want = S.pz.sol[0];
    board.set({ fen: S.defFen, lastMove: null, movable: S.hero, arrows: [{ from: want.slice(0, 2), to: want.slice(2, 4), kind: 'threat' }] });
    $('#turn').textContent = `${COLOR_NAME[S.hero]} to move`;
    panel(`${head()}<p class="why">Your move. Deal with the threat.</p><p class="hint">The red arrow is what they want to play.</p>`);
    scrollTop();
  }

  async function defendMove(uci) {
    const fen = S.defFen;
    const c = new Chess(fen);
    const m = playUci(c, uci);
    if (!m) return;
    S.phase = 'defend-check';
    board.set({ fen: c.fen(), lastMove: { from: m.from, to: m.to }, movable: null, arrows: [] });
    panel(`${head()}<div class="thinking">Checking ${esc(m.san)}… this takes a few seconds.</div>`);
    let ex;
    try {
      ex = await explainMove({ fenBefore: fen, playedUci: uci, hero: S.hero, ply: 1, history: [] });
    } catch (e) {
      if (e.message === 'cancelled') return;
      S.phase = 'defend';
      board.set({ fen, movable: S.hero });
      return panel(`${head()}<p>The engine had a problem checking that. Try again.</p>`);
    }
    if (!S.defUci) S.defUci = uci;
    S.defEx = ex;
    S.layer = 0;
    const good = ex.grade === 'best' || ex.grade === 'good';
    if (good) {
      S.phase = 'done';
      const hopeless = ex.wb < 20;
      S.res = await record({ firstTry: S.firstTry && S.defTries === 0 });
      const note = hopeless
        ? `There was no full defence here — ${esc(m.san)} is the best try and limits the damage.`
        : ex.grade === 'best' ? `${esc(m.san)} is exactly what the engine would play.` : `${esc(m.san)} works. The engine slightly prefers ${esc(ex.bestSan)}.`;
      panel(`${head()}<p class="why"><span class="ok">✓ That deals with it.</span></p><p>${note}</p>
        <div class="actions"><button class="btn primary" data-act="next">${S.i + 1 < set.items.length ? 'Next puzzle' : 'Finish'} ›</button></div>`, 'good');
      dots();
      return;
    }
    S.defTries++;
    S.firstTry = false;
    S.phase = 'defend-wrong';
    defendWrongPanel();
  }

  function defendWrongPanel() {
    const ex = S.defEx;
    let body = `<p class="why"><span class="miss">✗ ${esc(ex.playedSan)}</span> doesn't stop it.</p><p>${esc(ex.why)}</p>`;
    if (S.layer >= 1) body += `<div class="more">${ex.more.map((x) => `<p>${esc(x)}</p>`).join('')}</div>${linesHtml(ex.lines, 'dl')}`;
    body += `<div class="actions"><button class="btn primary" data-act="defend">Try again</button>
      ${S.layer === 0 ? '<button class="btn" data-act="defmore">Tell me more</button>' : ''}
      <button class="btn ghost" data-act="defshow">Show me</button></div>`;
    panel(`${head()}${body}`, 'bad');
  }

  async function defendShow() {
    const ex = S.defEx;
    S.phase = 'done';
    board.set({ fen: S.defFen, lastMove: null, movable: null, arrows: [{ from: ex.bestUci.slice(0, 2), to: ex.bestUci.slice(2, 4), kind: 'best' }] });
    S.res = await record({ firstTry: false });
    const line = ex.lines.find((l) => l.title.startsWith('Better'));
    panel(`${head()}<p class="why">The best defence was <b>${esc(ex.bestSan)}</b>.</p>${ex.more.slice(1).map((x) => `<p>${esc(x)}</p>`).join('')}
      ${line ? linesHtml([line], 'bl') : ''}
      <div class="actions"><button class="btn primary" data-act="next">${S.i + 1 < set.items.length ? 'Next puzzle' : 'Finish'} ›</button></div>`, 'meh');
    S.defShowLine = line;
    dots();
  }

  // ---- Stepping through a line on the board ------------------------------
  function linesHtml(lines, key) {
    S.lineSets = S.lineSets || {};
    S.lineSets[key] = lines;
    return lines.length ? `<div class="lines">${lines.map((l, k) => `<button class="line-btn" data-line="${key}:${k}"><span>▶</span> ${esc(l.title)} <small>${esc(l.steps.slice(0, 3).map((s) => s.san).join(' '))}${l.steps.length > 3 ? '…' : ''}</small></button>`).join('')}</div>` : '';
  }

  function startLine(line) {
    S.savedPanel = $('#panel').innerHTML;
    S.savedBoard = { fen: board.fen, lastMove: board.lastMove, arrows: board.arrows, movable: board.movable };
    S.line = line;
    S.lineIdx = 1;
    drawLine();
  }

  function drawLine() {
    const l = S.line;
    const step = l.steps[S.lineIdx - 1];
    board.set({ fen: step ? step.fen : l.fen, lastMove: step ? { from: step.move.from, to: step.move.to } : null, arrows: [], movable: null });
    panel(`<div class="move-head"><b>${esc(l.title)}</b><span class="who">${S.lineIdx}/${l.steps.length}</span></div>
      <div class="line-moves">${l.steps.map((s, k) => `<button class="mchip ${k + 1 === S.lineIdx ? 'cur' : ''}" data-ls="${k + 1}">${esc(s.san)}</button>`).join('')}</div>
      <p class="why">${step ? esc(step.text) : 'Starting position.'}</p>
      <div class="actions"><button class="btn" data-act="lprev">◀</button><button class="btn primary" data-act="lnext">▶</button><button class="btn ghost" data-act="lback">Back</button></div>`, 'line-card');
  }

  function endLine() {
    S.line = null;
    $('#panel').innerHTML = S.savedPanel;
    board.set(S.savedBoard);
  }

  // ---- Panel buttons -----------------------------------------------------
  async function onPanel(e) {
    const ls = e.target.closest('[data-ls]');
    if (ls && S.line) { S.lineIdx = +ls.dataset.ls; return drawLine(); }
    const lb = e.target.closest('[data-line]');
    if (lb) { const [k, n] = lb.dataset.line.split(':'); return startLine(S.lineSets[k][+n]); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'lnext') { S.lineIdx = Math.min(S.line.steps.length, S.lineIdx + 1); return drawLine(); }
    if (act === 'lprev') { S.lineIdx = Math.max(0, S.lineIdx - 1); return drawLine(); }
    if (act === 'lback') return endLine();
    if (act === 'next') return next();
    if (act === 'giveup') return giveUp();
    if (act === 'retry') {
      board.set({ fen: S.lastWrong.fen, lastMove: null, arrows: [], movable: S.hero });
      S.wrongEx = S.wrongEx && S.wrongEx.uci === S.lastWrong.uci ? S.wrongEx : null;
      return panel(`${head()}<p class="why">Have another look.</p><div class="actions"><button class="btn ghost" data-act="giveup">Show me the answer</button></div>`);
    }
    if (act === 'whynot') {
      S.layer = 1;
      wrongPanel();
      await explainWrong();
      if (S.phase === 'solve' && S.layer >= 1) wrongPanel();
      return;
    }
    if (act === 'whynot2') { S.layer = 2; return wrongPanel(); }
    if (act === 'whyworks') { S.layer = 1; return solvedPanel(); }
    if (act === 'moresol') { S.layer = 2; return solvedPanel(); }
    if (act === 'showthreat') { S.firstTry = false; return threatFound(null, true); }
    if (act === 'defend') return startDefend();
    if (act === 'defmore') { S.layer = 1; return defendWrongPanel(); }
    if (act === 'defshow') return defendShow();
  }

  // ---- Saving ------------------------------------------------------------
  async function record({ firstTry }) {
    const it = S.item;
    const pz = S.pz;
    const result = { id: pz.id, theme: pz.theme, kind: it.kind, firstTry, rating: pz.r, data: pz.live ? { id: pz.id, fen: pz.fen, last: pz.last, sol: pz.sol, r: pz.r, t: pz.t } : null };
    const delta = recordResult(p, result);
    S.results[S.i] = { firstTry, kind: it.kind, theme: pz.theme, delta };
    let gameId = null;
    try { gameId = await archive(firstTry); } catch (e) { console.warn(e); C.toast(e.message); }
    S.results[S.i].gameId = gameId;
    try { await saveProgress(p); } catch (e) { console.warn(e); }
    return { delta };
  }

  // Each attempt goes into the review archive as a short "game" that starts
  // from the puzzle position, so it can be opened in the review screen.
  async function archive(firstTry) {
    const it = S.item;
    const pz = S.pz;
    let c, moves;
    if (it.kind === 'solve') {
      c = new Chess(pz.fen);
      moves = S.played;
    } else {
      c = new Chess(S.defFen);
      moves = S.defUci ? [S.defUci] : [];
    }
    for (const u of moves) if (!playUci(c, u)) break;
    if (!c.history().length) return null;
    const name = C.profile().name;
    const label = `Puzzle: ${themeName(pz.theme)}`;
    c.setHeader('White', S.hero === 'w' ? name : label);
    c.setHeader('Black', S.hero === 'b' ? name : label);
    c.setHeader('Result', '*');
    const pgn = c.pgn();
    const { moves: mv } = gameLine(pgn);
    const solutionSan = [];
    { const s = new Chess(startFen(pz)); for (const u of pz.sol) { const m = playUci(s, u); if (!m) break; solutionSan.push(m.san); } }
    const game = {
      id: newId(),
      profileId: C.profile().id,
      createdAt: Date.now(),
      source: 'puzzle',
      sourceId: 'lichess-puzzle:' + pz.id,
      pgn,
      hero: S.hero,
      white: S.hero === 'w' ? name : label,
      black: S.hero === 'b' ? name : label,
      result: '*',
      date: dayKey(),
      moveCount: mv.length,
      evals: [],
      analysisVersion: 1,
      notes: {},
      puzzle: { id: pz.id, theme: pz.theme, kind: it.kind, firstTry, review: !!it.review, rating: pz.r, solution: solutionSan, defence: it.kind === 'threat' ? (S.defEx ? S.defEx.bestSan : null) : null },
    };
    game.title = label;
    await store.saveGame(game);
    return game.id;
  }

  // ---- End of set --------------------------------------------------------
  async function finish() {
    finishSet(p, set.items.map((x) => x.p.theme));
    await saveProgress(p);
    const s = streakInfo(p);
    const first = S.results.filter((r) => r && r.firstTry).length;
    const delta = p.rating - S.ratingStart;
    board.set({ movable: null, arrows: [] });
    C.app.querySelector('main').classList.remove('review-layout', 'pz-layout');
    C.app.querySelector('main').classList.add('narrow');
    C.app.querySelector('main').innerHTML = `
      <div class="card pz-done">
        <div class="pz-score">${first}<small>/${set.items.length}</small></div>
        <p class="why">${first === set.items.length ? 'A clean sweep.' : first >= set.items.length - 1 ? 'Very nearly perfect.' : first >= set.items.length / 2 ? 'Solid work.' : 'Tough set — the ones you missed will come back for another go.'}</p>
        <div class="pz-stats inline">
          <div><span class="big">${p.rating}</span><small>rating ${delta ? `(${delta > 0 ? '+' : ''}${delta})` : ''}</small></div>
          <div><span class="big">${flame(s.current)}</span><small>${s.current === 1 ? 'day' : 'days'} in a row</small></div>
        </div>
      </div>
      <h2 class="section-title">This set</h2>
      <div class="pz-history">${set.items.map((it, k) => {
        const r = S.results[k] || {};
        return `<a class="pz-row" ${r.gameId ? `href="#/game/${r.gameId}"` : ''}>
          <span class="pz-mark ${r.firstTry ? 'ok' : 'miss'}">${r.firstTry ? '✓' : '✗'}</span>
          <span class="pz-row-main"><b>${esc(themeName(it.p.theme))}</b><small>${it.kind === 'threat' ? 'Spot the threat' : 'Find the move'}</small></span>
          ${r.gameId ? '<span class="pz-row-go">Review ›</span>' : ''}</a>`;
      }).join('')}</div>
      <div class="actions"><a class="btn primary" href="#/puzzles/play/${set.mode === 'daily' ? 'daily' : set.theme}?again=${Date.now()}">Another set</a><a class="btn" href="#/puzzles">All themes</a><a class="btn ghost" href="#/">Home</a></div>`;
  }

  next();
}
