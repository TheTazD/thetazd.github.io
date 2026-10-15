// Pillar 4 screens: the player's plan (diagnosis + current weakness), the
// lesson with positions from their own games, and the weakness pages.
import { Board } from './board.js';
import { store } from './store.js';
import { gameLine, ANALYSIS_VERSION } from './analysis.js';
import { playUci, COLOR_NAME, Chess } from './chessutil.js';
import { loadProgress, saveProgress } from './puzzles.js';
import { THEME } from './themes.js';
import {
  WEAKNESSES, currState, noteGame, diagnose, topCandidate, startWeakness, finishLearning,
  drillProgress, verifyStatus, retestsDue, advance, puzzleLogFrom, RETEST_STEPS,
} from './curriculum.js';

let C; // { app, $, esc, topbar, go, toast, profile() }
export function initCoach(ctx) { C = ctx; }
const esc = (s) => C.esc(s);
const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const STAGES = [['learn', 'Learn'], ['drill', 'Drill'], ['verify', 'Prove it'], ['done', 'Fixed']];

function unpackEval(e) { return e ? { score: e.s, best: e.b, pv: e.p || [], depth: e.d } : null; }

// ---------------------------------------------------------------------------
// Evidence gathering
// ---------------------------------------------------------------------------
// Record a game's evidence once its analysis is complete (review screen and
// matches call this). Returns messages to show, if any.
export async function recordGame(game, line, evals) {
  if (!game || game.source === 'puzzle') return [];
  const p = await loadProgress(game.profileId);
  const c = currState(p);
  if (c.games[game.id]) return [];
  const msgs = noteGame(p, game, line, evals);
  if (c.games[game.id]) await saveProgress(p);
  return msgs;
}

// Read archived games the curriculum hasn't seen yet (once each).
async function backfill(p, summaries, onStep) {
  const c = currState(p);
  c.pending = c.pending || {};
  const todo = summaries.filter((s) => s.source !== 'puzzle' && !c.games[s.id] && !c.pending[s.id]).slice(0, 30);
  let changed = false;
  for (let i = 0; i < todo.length; i++) {
    onStep(i + 1, todo.length);
    const g = await store.getGame(todo[i].id);
    if (!g) continue;
    const line = gameLine(g.pgn);
    const evals = g.analysisVersion === ANALYSIS_VERSION ? (g.evals || []).map(unpackEval) : [];
    if (evals.length >= line.fens.length && evals.every(Boolean)) noteGame(p, g, line, evals);
    else c.pending[g.id] = true; // not analysed yet: picked up when opened in review
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Home card
// ---------------------------------------------------------------------------
export async function homeCoachCard() {
  const p = await loadProgress(C.profile().id);
  const c = currState(p);
  const due = retestsDue(p);
  let title = 'Your training plan', sub = 'Find your biggest weakness and fix it, one at a time.', btn = 'Open';
  if (c.active) {
    const W = WEAKNESSES[c.active.w];
    const stage = { learn: 'start with the lesson', drill: 'drilling', verify: 'proving it in games' }[c.active.stage];
    title = `Working on: ${W.name}`;
    sub = `Step ${['learn', 'drill', 'verify'].indexOf(c.active.stage) + 1} of 3 — ${stage}.`;
    btn = 'Continue';
  } else if (Object.keys(c.games).length) {
    sub = 'Ready for your next weakness.';
  }
  if (due.length) sub += ` ${due.length === 1 ? 'A re-test is' : `${due.length} re-tests are`} due.`;
  return `<section>
    <h2 class="section-title">Coach</h2>
    <a class="card pz-daily coach-home" href="#/coach">
      <span class="pz-daily-ico">◎</span>
      <span class="pz-home-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
      <span class="pz-row-go">${btn} ›</span>
    </a>
  </section>`;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------
function tracker(stage) {
  const idx = stage === 'done' ? 3 : ['learn', 'drill', 'verify'].indexOf(stage);
  return `<ol class="tracker">${STAGES.map(([k, label], i) => `<li class="${i < idx ? 'done' : i === idx ? 'cur' : ''}"><span>${i < idx ? '✓' : i + 1}</span>${label}</li>`).join('')}</ol>`;
}

function evidenceText(r) {
  const bits = [];
  if (r.count) bits.push(`${r.count}× in your last ${r.games} game${r.games === 1 ? '' : 's'}`);
  else if (r.games) bits.push(`not seen in your last ${r.games} games`);
  if (r.puzzles >= 4) bits.push(`${r.puzzlesOk}/${r.puzzles} in ${r.w.kind === 'threat' ? 'spot-the-threat' : 'find-the-move'} puzzles`);
  return bits.join(' · ');
}

export async function renderCoach() {
  const prof = C.profile();
  C.app.innerHTML = `${C.topbar('Your plan')}<main class="page narrow"><div class="card"><div class="thinking" id="bf">Looking through your games…</div></div></main>`;
  const p = await loadProgress(prof.id);
  const c = currState(p);
  const summaries = await store.listGames(prof.id);
  const changed = await backfill(p, summaries, (k, n) => { const el = C.$('#bf'); if (el) el.textContent = `Reading your games… ${k}/${n}`; });
  const msgs = advance(p);
  if (changed || msgs.length) await saveProgress(p);
  if (!C.$('#bf')) return; // left the page
  const ranked = diagnose(p, puzzleLogFrom(summaries));
  const nGames = Object.keys(c.games).length;
  const nPuzzles = summaries.filter((s) => s.source === 'puzzle').length;
  const pending = Object.keys(c.pending || {}).filter((id) => !c.games[id] && summaries.some((s) => s.id === id)).length;
  const due = retestsDue(p);
  const top = topCandidate(ranked, c);

  let main = '';
  if (c.active) main = activeCard(p, ranked);
  else if (top) {
    main = `<div class="card coach-top">
      <p class="eyebrow">Your top weakness</p>
      <h2 class="card-title">${esc(top.w.name)}</h2>
      <p>${esc(top.w.blurb)}</p>
      <p class="hint">${esc(evidenceText(top))}</p>
      <button class="btn primary wide" data-start="${top.w.id}">Start working on it</button>
      <p class="hint center">Or pick a different one from the list below.</p>
    </div>`;
  } else {
    main = `<div class="card">
      <h2 class="card-title">Not enough to go on yet</h2>
      <p>The plan is built from your games and puzzles. ${nGames ? 'Nothing stands out so far — nice.' : 'Play a match or review a game and it\'ll start finding patterns.'}</p>
      <div class="actions"><a class="btn primary" href="#/play">Play a match</a><a class="btn" href="#/puzzles">Puzzles</a></div>
    </div>`;
  }

  const others = ranked.filter((r) => !r.mastered && (c.active || r !== top) && (!c.active || r.w.id !== c.active.w)).slice(0, 8);
  const mastered = Object.entries(c.mastered).sort((a, b) => a[1].due - b[1].due);
  C.app.innerHTML = `${C.topbar('Your plan')}
  <main class="page narrow">
    ${msgs.length ? `<div class="card coach-msg">${msgs.map((m) => `<p>${esc(m.text)}</p>`).join('')}</div>` : ''}
    ${main}
    ${due.length ? `<h2 class="section-title">Re-tests due</h2><div class="pz-history">${due.map((d) => `<a class="pz-row" href="#/puzzles/play/coach-retest"><span class="pz-mark ok">↻</span><span class="pz-row-main"><b>${esc(WEAKNESSES[d.w].name)}</b><small>Fixed ${fmtDay(d.at)} · 4 quick puzzles to check it's still there</small></span><span class="pz-row-go">Start ›</span></a>`).join('')}</div>` : ''}
    <h2 class="section-title">${c.active || top ? 'Next in line' : 'Diagnosis'}</h2>
    ${others.length ? `<div class="theme-list">${others.map((r) => `<a class="theme-row" href="#/coach/w/${encodeURIComponent(r.w.id)}">
      <span class="theme-ico">${THEME[r.w.theme].icon}</span>
      <span class="theme-main"><b>${esc(r.w.name)}</b><small>${esc(evidenceText(r))}</small>
        <span class="meter sev"><span style="width:${Math.min(100, Math.round((r.score / (ranked[0].score || 1)) * 100))}%"></span></span></span>
      <span class="pz-row-go">›</span></a>`).join('')}</div>` : '<div class="empty">Nothing else stands out yet.</div>'}
    ${mastered.length ? `<h2 class="section-title">Fixed</h2><div class="pz-history">${mastered.map(([w, m]) => `<a class="pz-row" href="#/coach/w/${encodeURIComponent(w)}"><span class="pz-mark ok">✓</span><span class="pz-row-main"><b>${esc(WEAKNESSES[w].name)}</b><small>Fixed ${fmtDay(m.at)} · next re-test ${fmtDay(m.due)}</small></span></a>`).join('')}</div>` : ''}
    <p class="hint center">Based on ${nGames} analysed game${nGames === 1 ? '' : 's'} and ${nPuzzles} puzzle attempt${nPuzzles === 1 ? '' : 's'}.${pending ? ` ${pending} game${pending === 1 ? ' hasn\'t' : 's haven\'t'} been analysed yet — open ${pending === 1 ? 'it' : 'them'} in review to include ${pending === 1 ? 'it' : 'them'}.` : ''}</p>
  </main>`;
  C.app.querySelectorAll('[data-start]').forEach((b) => (b.onclick = async () => {
    startWeakness(p, b.dataset.start, ranked);
    await saveProgress(p);
    C.go('coach/learn');
  }));
}

function activeCard(p, ranked) {
  const c = currState(p);
  const a = c.active;
  const W = WEAKNESSES[a.w];
  const r = ranked.find((x) => x.w.id === a.w);
  let body = '';
  if (a.stage === 'learn') {
    body = `<p>First, a short lesson: how ${esc(W.name.toLowerCase())} works, and the moments it happened in your own games.</p>
      <a class="btn primary wide" href="#/coach/learn">Start the lesson</a>`;
  } else if (a.stage === 'drill') {
    const d = drillProgress(a);
    body = `<p>Focused puzzle sets — ${W.kind === 'threat' ? 'mostly <b>spot the threat</b>, because the problem is seeing what your opponent has' : 'mostly <b>find the move</b>, because the problem is spotting your own chances'}.</p>
      <div class="coach-meter"><span class="meter"><span style="width:${d.pct}%"></span><i style="left:75%"></i></span>
      <small>${d.attempts ? `${d.pct}% over your last ${d.attempts} · ${d.sets} set${d.sets === 1 ? '' : 's'} done` : 'No sets yet'} · aim: 75% over 2+ sets</small></div>
      <a class="btn primary wide" href="#/puzzles/play/coach-focus">Drill set (${6} puzzles)</a>
      <a class="btn ghost wide" href="#/coach/learn">Lesson again</a>`;
  } else if (a.stage === 'verify') {
    const v = verifyStatus(p);
    const cu = v.checkup === 'passed'
      ? '<li class="ok-item">✓ Check-up set passed</li>'
      : v.checkupReady ? '<li>Check-up set: ready now</li>' : `<li>Check-up set: unlocks ${fmtDay(v.checkupDue)} (a gap tests whether it stuck)</li>`;
    body = `<p>Puzzles are one thing — now it has to show up in real games.</p>
      <ul class="verify-list">
        <li class="${v.gamesOk ? 'ok-item' : ''}">${v.gamesOk ? '✓ ' : ''}Games since drilling: <b>${Math.min(v.games, 99)}</b> of ${v.need}${v.games ? ` · happened ${v.count}×` : ''}</li>
        ${cu}
      </ul>
      ${v.checkup !== 'passed' && v.checkupReady ? '<a class="btn primary wide" href="#/puzzles/play/coach-checkup">Check-up set (4 puzzles)</a>' : ''}
      ${!v.gamesOk ? `<a class="btn ${v.checkup !== 'passed' && v.checkupReady ? '' : 'primary'} wide" href="#/play">Play a match</a>` : ''}
      <p class="hint">Reviewed games from Lichess or over the board count too.</p>`;
  }
  return `<div class="card coach-top">
    <p class="eyebrow">Working on${a.rounds > 1 ? ` · round ${a.rounds}` : ''}</p>
    <h2 class="card-title">${esc(W.name)}</h2>
    <p class="hint">${esc(W.blurb)}${r ? ` ${esc(evidenceText(r))}.` : ''}</p>
    ${tracker(a.stage)}
    ${body}
    <a class="link-btn" href="#/coach/w/${encodeURIComponent(a.w)}">See the evidence</a>
  </div>`;
}

// ---------------------------------------------------------------------------
// Lesson (active weakness) and weakness pages
// ---------------------------------------------------------------------------
export async function renderLesson() {
  const p = await loadProgress(C.profile().id);
  const c = currState(p);
  if (!c.active) return C.go('coach');
  return renderWeakness(c.active.w, true);
}

export async function renderWeakness(wid, lesson = false) {
  wid = decodeURIComponent(wid);
  const W = WEAKNESSES[wid];
  if (!W) return C.go('coach');
  const prof = C.profile();
  const p = await loadProgress(prof.id);
  const c = currState(p);
  const summaries = await store.listGames(prof.id);
  const ranked = diagnose(p, puzzleLogFrom(summaries));
  const r = ranked.find((x) => x.w.id === wid);
  const T = THEME[W.theme];
  const isActive = c.active && c.active.w === wid;
  const m = c.mastered[wid];
  const examples = (r ? r.examples : []).slice(0, 4);
  C.app.innerHTML = `${C.topbar(lesson ? 'Lesson' : W.name, '#/coach')}
  <main class="page narrow">
    <div class="card theme-intro">
      <div class="theme-head"><span class="theme-ico big">${T.icon}</span><div><h2 class="card-title">${esc(W.name)}</h2><span class="hint">${esc(W.blurb)}</span></div></div>
      ${r ? `<p class="hint">${esc(evidenceText(r))}</p>` : ''}
      <h3 class="sub">How it works</h3>
      <p>${esc(T.concept)}</p>
      <h3 class="sub">The habit</h3>
      <p class="habit">${esc(W.habit)}</p>
    </div>
    <h2 class="section-title">From your games</h2>
    ${examples.length ? `<div class="card ex-card">
      <div class="ex-top"><b id="ex-n"></b><span class="ex-nav"><button class="nbtn" id="ex-prev" aria-label="Previous example">◀</button><button class="nbtn" id="ex-next" aria-label="Next example">▶</button></span></div>
      <div id="ex-board" class="ex-board"></div>
      <div id="ex-panel"></div>
    </div>` : `<div class="empty">No examples from your games yet${r && r.puzzles ? ' — this one shows up in your puzzles' : ''}. The drill will give you plenty of practice positions.</div>`}
    <div class="actions">
      ${lesson ? `<button class="btn primary wide" id="go-drill">I've got it — start drilling</button>` : isActive ? '<a class="btn primary" href="#/coach">Back to your plan</a>' : m ? `<a class="btn" href="#/puzzles/theme/${W.theme}">Practise ${esc(T.name.toLowerCase())}</a>` : `<button class="btn primary" id="switch">${c.active ? 'Work on this instead' : 'Work on this'}</button><a class="btn" href="#/puzzles/theme/${W.theme}">Just practise</a>`}
    </div>
    ${m ? `<p class="hint center">Fixed ${fmtDay(m.at)}. Next re-test ${fmtDay(m.due)}.</p>` : ''}
    ${!lesson && !isActive && !m && c.active ? `<p class="hint center">Switching parks ${esc(WEAKNESSES[c.active.w].name.toLowerCase())}; it stays on your list.</p>` : ''}
  </main>`;
  if (C.$('#go-drill')) C.$('#go-drill').onclick = async () => { finishLearning(p); await saveProgress(p); C.go('puzzles/play/coach-focus'); };
  if (C.$('#switch')) C.$('#switch').onclick = async () => { startWeakness(p, wid, ranked); await saveProgress(p); C.go('coach/learn'); };
  if (examples.length) exampleTrainer(examples, W);
}

// Positions from the player's own games: commit to a move before the reveal.
function exampleTrainer(examples, W) {
  const board = new Board(C.$('#ex-board'), { onMove: (u) => onMove(u) });
  const cache = {};
  let i = 0, ex = null, tries = 0, revealed = false;

  async function load(k) {
    i = (k + examples.length) % examples.length;
    const e = examples[i];
    C.$('#ex-n').textContent = `Example ${i + 1} of ${examples.length}`;
    C.$('#ex-panel').innerHTML = '<div class="thinking">Loading…</div>';
    if (!cache[e.game]) cache[e.game] = store.getGame(e.game).then((g) => (g ? { g, line: gameLine(g.pgn) } : null));
    const got = await cache[e.game];
    if (!got) { C.$('#ex-panel').innerHTML = '<p class="hint">That game has been deleted.</p>'; return; }
    const { g, line } = got;
    const allowed = W.side === 'allowed';
    const hero = g.hero;
    const fen = line.fens[allowed ? e.ply : e.ply - 1];
    const mover = fen.split(' ')[1];
    const n = Math.ceil(e.ply / 2);
    const dots = hero === 'w' ? '.' : '...';
    const last = allowed ? line.moves[e.ply - 1] : line.moves[e.ply - 2];
    ex = { e, g, fen, mover, hero, allowed, n, dots };
    tries = 0; revealed = false;
    board.setOrientation(hero);
    board.set({ fen, lastMove: last ? { from: last.from, to: last.to } : null, arrows: [], marks: {}, movable: mover });
    const opp = COLOR_NAME[hero === 'w' ? 'b' : 'w'];
    C.$('#ex-panel').innerHTML = allowed
      ? `<p class="why">You played <b>${n}${dots} ${esc(e.ps)}</b>. What could ${opp} do now?</p><p class="hint">Tap ${opp}'s best move on the board.</p>`
      : `<p class="why">Move ${n}: you played ${esc(e.ps)}. What did you have instead?</p><p class="hint">Tap your move on the board.</p>`;
    C.$('#ex-panel').insertAdjacentHTML('beforeend', `<div class="actions"><button class="btn ghost" id="ex-show">Show me</button></div>`);
    C.$('#ex-show').onclick = reveal;
  }

  function onMove(uci) {
    if (!ex || revealed) return;
    const c = new Chess(ex.fen);
    const m = playUci(c, uci);
    if (!m) return;
    const right = uci === ex.e.k || (W.theme.startsWith('mate') || W.theme === 'backRankMate') && c.isCheckmate();
    if (right) return reveal(true);
    tries++;
    board.set({ fen: ex.fen, arrows: [{ from: uci.slice(0, 2), to: uci.slice(2, 4), kind: 'played' }], movable: tries < 2 ? ex.mover : null });
    const p = C.$('#ex-panel');
    p.querySelector('.ex-try')?.remove();
    p.insertAdjacentHTML('afterbegin', `<p class="ex-try miss">${tries < 2 ? `Not ${esc(m.san)} — have another look.` : `Not ${esc(m.san)} either.`}</p>`);
    if (tries >= 2) reveal(false);
  }

  function reveal(gotIt) {
    revealed = true;
    const { e, allowed, n, dots, g } = ex;
    board.set({ fen: ex.fen, arrows: [{ from: e.k.slice(0, 2), to: e.k.slice(2, 4), kind: allowed ? 'threat' : 'best' }], movable: null });
    const opp = COLOR_NAME[ex.mover];
    const what = allowed
      ? `${opp} had <b>${esc(e.ks)}</b>, which ${esc(e.d)}.`
      : `You had <b>${esc(e.ks)}</b>, which ${esc(e.d)}.`;
    C.$('#ex-panel').innerHTML = `${gotIt === true ? '<p class="ex-try ok">Yes — that\'s it.</p>' : ''}
      <p class="why">${what}</p>
      <p class="hint">${allowed ? `Before ${n}${dots} ${esc(e.ps)}, the habit above would have caught it.` : `You played ${esc(e.ps)} instead.`}</p>
      <div class="actions">${examples.length > 1 ? '<button class="btn" id="ex-more">Next example</button>' : ''}<a class="btn ghost" href="#/game/${g.id}?ply=${e.ply}">See it in the game</a></div>`;
    if (C.$('#ex-more')) C.$('#ex-more').onclick = () => load(i + 1);
  }

  C.$('#ex-prev').onclick = () => load(i - 1);
  C.$('#ex-next').onclick = () => load(i + 1);
  if (examples.length < 2) C.$('.ex-nav').classList.add('hidden');
  load(0);
}

export { RETEST_STEPS };
