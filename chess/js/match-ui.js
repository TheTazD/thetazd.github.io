// Pillar 3 screens: play hub, live match, result (with rating change), and
// the assessment report.
import { Board } from './board.js';
import { engine } from './engine.js';
import { store, newId, cache } from './store.js';
import { gameLine, analyseGame, gradeAll, ANALYSIS_VERSION } from './analysis.js';
import { explainMove } from './explain.js';
import { Chess, playUci, materialFor, COLOR_NAME, moveToUci } from './chessutil.js';
import { loadProgress, saveProgress, LEVELS, dayKey } from './puzzles.js';
import { botMove, botAcceptsDraw } from './bot.js';
import {
  matchState, assessmentDue, performance, ratingChange, nextBotLevel, gameStats, worstMoves,
  themeForMistake, buildAssessment, AREAS, MISTAKE_LABEL, ASSESS_EVERY,
} from './match.js';
import { themeName, THEME } from './themes.js';

let C; // { app, $, esc, topbar, go, toast, profile() }
export function initMatch(ctx) { C = ctx; }
const esc = (s) => C.esc(s);
const BOT = 'Coach bot';
const liveKey = () => 'match.' + C.profile().id;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
async function ensureRating(p, next) {
  const m = matchState(p);
  if (m.rating) return true;
  if (p.rating) { m.rating = p.rating; await saveProgress(p); return true; } // from puzzles
  C.app.innerHTML = `${C.topbar('Play')}
  <main class="page narrow"><div class="card">
    <h2 class="card-title">How strong is ${esc(C.profile().name)}?</h2>
    <p class="hint">The opponent starts here and adjusts after every game, so a rough guess is fine.</p>
    <div class="level-list">${LEVELS.map((l) => `<button class="level-btn" data-r="${l.rating}"><b>${esc(l.label)}</b><small>starts around ${l.rating}</small></button>`).join('')}</div>
  </div></main>`;
  C.app.querySelectorAll('.level-btn').forEach((b) => (b.onclick = async () => {
    m.rating = +b.dataset.r;
    if (!p.rating) p.rating = m.rating;
    await saveProgress(p);
    next();
  }));
  return false;
}

function resultWord(r) {
  return r === 'win' ? { text: 'Won', cls: 'won' } : r === 'loss' ? { text: 'Lost', cls: 'lost' } : { text: 'Draw', cls: 'draw' };
}

export async function homeMatchCard() {
  const p = await loadProgress(C.profile().id);
  const m = matchState(p);
  const live = cache.get(liveKey(), null);
  const due = m.rating ? assessmentDue(p) : null;
  const last = m.games[m.games.length - 1];
  let sub = 'A full game against an opponent pitched at your level.';
  if (live) sub = `You have a game in progress (move ${Math.ceil((live.moves.length + 1) / 2)}).`;
  else if (due) sub = due === 'first' ? 'Your first match doubles as an assessment.' : 'An assessment match is due.';
  else if (last) sub = `Last game: ${resultWord(last.result).text.toLowerCase()}, ${last.heroAcc}% accuracy. Rating ${m.rating}.`;
  return `<section>
    <h2 class="section-title">Play</h2>
    <div class="card pz-home">
      <div class="pz-home-text"><b>${live ? 'Continue your game' : 'Play a match'}</b><small>${esc(sub)}</small></div>
      <div class="actions">
        <a class="btn primary" href="${live ? '#/play/game' : '#/play'}">${live ? 'Continue' : 'Play'}</a>
        ${live ? '' : '<a class="btn" href="#/play">Progress</a>'}
      </div>
    </div>
  </section>`;
}

// One-series line chart with a tap/hover readout.
function lineChart(id, values, labels, { title, unit = '', min, max }) {
  const W = 320, H = 120, P = { l: 34, r: 10, t: 12, b: 20 };
  const lo = min ?? Math.floor((Math.min(...values) - 20) / 50) * 50;
  const hi = max ?? Math.ceil((Math.max(...values) + 20) / 50) * 50;
  const x = (i) => P.l + (values.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (values.length - 1));
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return `<figure class="chart" id="${id}" data-values='${JSON.stringify(values)}' data-labels='${esc(JSON.stringify(labels))}' data-unit="${esc(unit)}">
    <figcaption><b>${esc(title)}</b><span class="chart-read" aria-live="polite">Now ${values[values.length - 1]}${esc(unit)}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: ${values.join(', ')}">
      ${ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${P.l - 6}" y="${y(t) + 3.5}" text-anchor="end">${t}</text>`).join('')}
      <polyline class="series" points="${pts}"/>
      ${values.map((v, i) => `<circle class="pt" cx="${x(i)}" cy="${y(v)}" r="3"/>`).join('')}
      <line class="cross hidden" y1="${P.t}" y2="${H - P.b}"/>
      <rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent"/>
    </svg>
  </figure>`;
}

function wireChart(el) {
  if (!el) return;
  const values = JSON.parse(el.dataset.values);
  const labels = JSON.parse(el.dataset.labels);
  const unit = el.dataset.unit;
  const svg = el.querySelector('svg');
  const cross = el.querySelector('.cross');
  const read = el.querySelector('.chart-read');
  const pts = [...el.querySelectorAll('.pt')];
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * 320;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(+p.getAttribute('cx') - sx) < Math.abs(+pts[best].getAttribute('cx') - sx)) best = i; });
    const cx = pts[best].getAttribute('cx');
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.classList.remove('hidden');
    pts.forEach((p, i) => p.classList.toggle('on', i === best));
    read.textContent = `${labels[best]}: ${values[best]}${unit}`;
  };
  const hide = () => { cross.classList.add('hidden'); pts.forEach((p) => p.classList.remove('on')); read.textContent = `Now ${values[values.length - 1]}${unit}`; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------
export async function renderPlayHub() {
  const p = await loadProgress(C.profile().id);
  if (!(await ensureRating(p, renderPlayHub))) return;
  const m = matchState(p);
  const live = cache.get(liveKey(), null);
  const due = assessmentDue(p);
  const all = await store.listGames(C.profile().id);
  const unrated = all.filter((g) => g.source === 'match' && g.match && !g.match.rated);
  const W = m.games.filter((g) => g.result === 'win').length;
  const D = m.games.filter((g) => g.result === 'draw').length;
  const L = m.games.length - W - D;
  const recent = m.games.slice(-15);
  const lastA = m.assessments[m.assessments.length - 1];
  const sinceA = lastA ? m.games.filter((g) => g.at > lastA.at).length : m.games.length;
  C.app.innerHTML = `${C.topbar('Play')}
  <main class="page narrow">
    <div class="card pz-stats">
      <div><span class="big">${m.rating}</span><small>match rating</small></div>
      <div><span class="big">${m.games.length}</span><small>games</small></div>
      <div><span class="big wdl">${W}<i>·</i>${D}<i>·</i>${L}</span><small>won · drawn · lost</small></div>
    </div>
    ${unrated.length ? `<a class="card pz-daily warn-card" href="#/play/result/${unrated[0].id}"><span class="pz-daily-ico">!</span><span><b>Finish scoring your last game</b><small>It was saved but not analysed yet.</small></span><span class="pz-row-go">›</span></a>` : ''}
    ${live ? `<a class="card pz-daily" href="#/play/game"><span class="pz-daily-ico">▶</span><span><b>Continue your game</b><small>vs ${BOT} (${live.botLevel}) · move ${Math.ceil((live.moves.length + 1) / 2)}</small></span><span class="pz-row-go">›</span></a>` : `
    <div class="card">
      <h2 class="card-title">${due ? 'Assessment match' : 'New match'}</h2>
      <p class="hint">${due === 'first' ? 'Your first game is an assessment: afterwards you get a breakdown of your openings, middlegames, endgames and play under pressure, and your daily puzzles start aiming at what it finds.' : due ? `It's been ${sinceA} games since your last assessment. This game ends with a full breakdown of where you're losing points.` : `The opponent plays at about your level (${m.rating}). Your rating moves on how well you play, not just the result. No take-backs.`}</p>
      <fieldset class="side-pick" id="colour"><legend>Play as</legend>
        <label><input type="radio" name="col" value="w"> White</label>
        <label><input type="radio" name="col" value="b"> Black</label>
        <label><input type="radio" name="col" value="r" checked> Either</label>
      </fieldset>
      <button class="btn primary wide" id="start">${due ? 'Start assessment match' : 'Start match'}</button>
      ${due ? '<button class="btn ghost wide" id="start-normal">Just a normal game for now</button>' : ''}
    </div>`}
    ${m.games.length >= 2 ? `<h2 class="section-title">Progress</h2>
    <div class="card charts">
      ${lineChart('ch-rating', [recent[0].ratingBefore, ...recent.map((g) => g.ratingAfter)], ['Start', ...recent.map((g) => g.date)], { title: 'Match rating' })}
      ${lineChart('ch-acc', recent.map((g) => g.heroAcc), recent.map((g) => g.date), { title: 'Accuracy', unit: '%', min: Math.max(0, Math.floor((Math.min(...recent.map((g) => g.heroAcc)) - 10) / 10) * 10), max: 100 })}
      <p class="hint">Last ${recent.length} games. Tap a chart to read a point.</p>
    </div>` : ''}
    ${lastA ? `<h2 class="section-title">Latest assessment</h2>
    <a class="card pz-daily" href="#/play/report/${m.assessments.length - 1}">
      <span class="pz-daily-ico">◎</span>
      <span><b>${lastA.weakest ? `Weakest area: ${esc(AREAS[lastA.weakest].name)}` : 'Assessment report'}</b><small>${new Date(lastA.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${lastA.focus.length ? ` · practising ${lastA.focus.map(themeName).join(', ')}` : ''}${due ? '' : ` · next in ${Math.max(0, ASSESS_EVERY - sinceA)} game${ASSESS_EVERY - sinceA === 1 ? '' : 's'}`}</small></span>
      <span class="pz-row-go">›</span></a>` : ''}
    <h2 class="section-title">Recent matches</h2>
    ${m.games.length ? `<div class="pz-history">${m.games.slice(-10).reverse().map((g) => {
      const r = resultWord(g.result);
      return `<a class="pz-row" href="#/play/result/${g.id}">
        <span class="res ${r.cls}">${r.text}</span>
        <span class="pz-row-main"><b>vs ${BOT} (${g.botLevel})${g.assess ? ' · assessment' : ''}</b><small>${esc(g.date)} · you ${g.heroAcc}% · bot ${g.botAcc}%</small></span>
        <span class="delta ${g.delta > 0 ? 'up' : g.delta < 0 ? 'down' : ''}">${g.delta > 0 ? '+' : ''}${g.delta}</span>
      </a>`;
    }).join('')}</div>` : '<div class="empty">Your matches will appear here.</div>'}
  </main>`;
  wireChart(C.$('#ch-rating'));
  wireChart(C.$('#ch-acc'));
  const start = async (assess) => {
    const v = C.app.querySelector('input[name=col]:checked').value;
    const hero = v === 'r' ? (m.games.length % 2 === 0 ? 'w' : 'b') : v;
    cache.set(liveKey(), { id: newId(), hero, botLevel: nextBotLevel(m), assess, moves: [], startedAt: Date.now() });
    C.go('play/game');
  };
  if (C.$('#start')) C.$('#start').onclick = () => start(!!due);
  if (C.$('#start-normal')) C.$('#start-normal').onclick = () => start(false);
}

// ---------------------------------------------------------------------------
// Live match
// ---------------------------------------------------------------------------
export async function renderMatchGame() {
  const live = cache.get(liveKey(), null);
  if (!live) return C.go('play');
  const hero = live.hero;
  const bot = hero === 'w' ? 'b' : 'w';
  const chess = new Chess();
  for (const u of live.moves) playUci(chess, u);
  C.app.innerHTML = `${C.topbar(live.assess ? 'Assessment match' : 'Match', '#/play')}
  <main class="page review-layout">
    <div class="board-col">
      <div class="player-strip top match-strip"><span>${BOT} <small>(${live.botLevel})</small></span><span id="mat-top" class="mat"></span><span id="status-top" class="status"></span></div>
      <div id="board"></div>
      <div class="player-strip match-strip"><span>${esc(C.profile().name)}</span><span id="mat-bot" class="mat"></span><span id="status-bot" class="status"></span></div>
      <div class="nav-row">
        <button class="btn" id="draw">½ Draw</button>
        <button class="btn" id="resign">⚑ Resign</button>
        <button class="nbtn" id="flip" aria-label="Flip board">⇅</button>
      </div>
    </div>
    <div class="side-col">
      <div id="mpanel"></div>
      <div id="movelist" class="movestrip"></div>
      <p class="hint">${live.assess ? 'Assessment game: play it as you would any other. ' : ''}No take-backs. The game is saved after every move, so you can leave and come back.</p>
    </div>
  </main>`;
  const $ = (s) => C.app.querySelector(s);
  const board = new Board($('#board'), { orientation: hero, onMove: (u) => onMove(u) });
  let over = false;
  let busy = false;

  function draw(last) {
    const turn = chess.turn();
    board.set({ fen: chess.fen(), lastMove: last ? { from: last.from, to: last.to } : null, movable: !over && turn === hero && !busy ? hero : null, arrows: [], marks: {} });
    const diff = materialFor(chess, hero);
    $('#mat-bot').textContent = diff > 0 ? `+${diff}` : '';
    $('#mat-top').textContent = diff < 0 ? `+${-diff}` : '';
    $('#status-bot').textContent = !over && turn === hero ? 'Your move' : '';
    $('#status-top').textContent = !over && turn === bot ? 'Thinking…' : '';
    const h = chess.history();
    $('#movelist').innerHTML = h.map((s, i) => (i % 2 === 0 ? `<span class="mnum">${i / 2 + 1}.</span>` : '') + `<span class="mchip ${(i % 2 === 0 ? 'w' : 'b') === hero ? 'mine' : 'theirs'}">${esc(s)}</span>`).join('');
    const strip = $('#movelist');
    strip.scrollLeft = strip.scrollWidth;
  }

  function persist() {
    live.moves = chess.history({ verbose: true }).map(moveToUci);
    cache.set(liveKey(), live);
  }

  function lastMove() {
    const h = chess.history({ verbose: true });
    return h[h.length - 1];
  }

  async function onMove(uci) {
    if (over || busy || chess.turn() !== hero) return;
    const m = playUci(chess, uci);
    if (!m) return;
    persist();
    draw(m);
    if (checkEnd()) return;
    await botTurn();
  }

  async function botTurn() {
    if (over || chess.turn() !== bot) return;
    busy = true;
    draw(lastMove());
    const t0 = Date.now();
    let res;
    try {
      res = await botMove(chess.fen(), live.botLevel);
    } catch (e) {
      busy = false;
      if (e.message === 'cancelled') return;
      C.toast('The engine had a problem. Tap to retry.');
      $('#mpanel').innerHTML = `<div class="card error"><p>The opponent couldn't move.</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').onclick = () => { $('#mpanel').innerHTML = ''; botTurn(); };
      return;
    }
    const wait = 450 + Math.random() * 700 - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!document.body.contains(board.el)) return; // left the page; the move is replayed on return
    const m = playUci(chess, res.uci);
    busy = false;
    persist();
    draw(m);
    checkEnd();
  }

  function checkEnd() {
    if (!chess.isGameOver()) return false;
    let result, reason;
    if (chess.isCheckmate()) { result = chess.turn() === hero ? 'loss' : 'win'; reason = 'Checkmate'; }
    else if (chess.isStalemate()) { result = 'draw'; reason = 'Stalemate'; }
    else if (chess.isThreefoldRepetition()) { result = 'draw'; reason = 'Same position three times'; }
    else if (chess.isInsufficientMaterial()) { result = 'draw'; reason = 'Not enough pieces left to mate'; }
    else { result = 'draw'; reason = '50 moves without a capture or pawn move'; }
    finish(result, reason);
    return true;
  }

  async function finish(result, reason) {
    over = true;
    draw(lastMove());
    const r = resultWord(result);
    $('#mpanel').innerHTML = `<div class="card move-card ${result === 'win' ? 'good' : result === 'loss' ? 'worst' : ''}"><p class="why"><b>${r.text === 'Draw' ? 'Draw' : `You ${r.text.toLowerCase()}`}</b> — ${esc(reason)}.</p><div class="thinking">Saving the game…</div></div>`;
    const name = C.profile().name;
    const botName = `${BOT} (${live.botLevel})`;
    chess.setHeader('Event', live.assess ? 'Assessment match' : 'Match');
    chess.setHeader('White', hero === 'w' ? name : botName);
    chess.setHeader('Black', hero === 'b' ? name : botName);
    const pgnResult = result === 'draw' ? '1/2-1/2' : (result === 'win') === (hero === 'w') ? '1-0' : '0-1';
    chess.setHeader('Result', pgnResult);
    chess.setHeader('Date', dayKey().replace(/-/g, '.'));
    chess.setHeader('Termination', reason);
    const game = {
      id: live.id,
      profileId: C.profile().id,
      createdAt: live.startedAt || Date.now(),
      source: 'match',
      sourceId: null,
      pgn: chess.pgn(),
      hero,
      white: hero === 'w' ? name : botName,
      black: hero === 'b' ? name : botName,
      result: pgnResult,
      date: dayKey(),
      moveCount: chess.history().length,
      evals: [],
      analysisVersion: ANALYSIS_VERSION,
      notes: {},
      match: { botLevel: live.botLevel, assess: live.assess, result, reason, rated: false },
    };
    game.title = `${game.white} vs ${game.black}`;
    try {
      await store.saveGame(game);
      cache.set(liveKey(), null);
      C.go('play/result/' + game.id);
    } catch (e) {
      $('#mpanel').innerHTML = `<div class="card error"><p>Couldn't save the game: ${esc(e.message)}</p><button class="btn" id="again">Try again</button></div>`;
      $('#again').onclick = () => finish(result, reason);
    }
  }

  $('#flip').onclick = () => board.flip();
  $('#resign').onclick = () => {
    if (over) return;
    $('#mpanel').innerHTML = `<div class="card move-card"><p><b>Resign this game?</b> It still counts, and you'll get the full analysis.</p>
      <div class="actions"><button class="btn danger" id="yes-resign">Yes, resign</button><button class="btn ghost" id="no-resign">Keep playing</button></div></div>`;
    $('#yes-resign').onclick = () => finish('loss', 'You resigned');
    $('#no-resign').onclick = () => ($('#mpanel').innerHTML = '');
  };
  $('#draw').onclick = async () => {
    if (over || busy || chess.turn() !== hero) return;
    $('#draw').disabled = true;
    $('#mpanel').innerHTML = `<div class="card"><div class="thinking">Offering a draw…</div></div>`;
    let ok = false;
    try { ok = await botAcceptsDraw(chess.fen(), bot, chess.history().length); } catch { /* treat as declined */ }
    $('#draw').disabled = false;
    if (ok) return finish('draw', 'Draw agreed');
    $('#mpanel').innerHTML = `<div class="card move-card"><p>${BOT} declines the draw and plays on.</p></div>`;
    setTimeout(() => { if ($('#mpanel')) $('#mpanel').innerHTML = ''; }, 2500);
  };

  draw(lastMove());
  if (!checkEnd() && chess.turn() === bot) botTurn();
}

// ---------------------------------------------------------------------------
// Result: analyse, score, explain the rating change
// ---------------------------------------------------------------------------
function packEval(e) { return e ? { s: e.score, b: e.best, p: (e.pv || []).slice(0, 6), d: e.depth } : null; }
function unpackEval(e) { return e ? { score: e.s, best: e.b, pv: e.p || [], depth: e.d } : null; }

export async function renderMatchResult(id) {
  const game = await store.getGame(id);
  if (!game || !game.match) throw new Error('That match could not be found.');
  const p = await loadProgress(C.profile().id);
  const m = matchState(p);
  const res = resultWord(game.match.result);
  C.app.innerHTML = `${C.topbar(game.match.assess ? 'Assessment match' : 'Match result', '#/play')}
  <main class="page narrow">
    <div class="card pz-done">
      <span class="res big-res ${res.cls}">${res.text}</span>
      <p class="hint">${esc(game.match.reason || '')} · vs ${BOT} (${game.match.botLevel}) · ${Math.ceil(game.moveCount / 2)} moves</p>
      <div id="score"></div>
    </div>
    <div id="detail"></div>
  </main>`;
  const $ = (s) => C.app.querySelector(s);

  if (!game.match.rated) {
    const { moves, fens } = gameLine(game.pgn);
    let evals = game.analysisVersion === ANALYSIS_VERSION ? (game.evals || []).map(unpackEval) : [];
    $('#score').innerHTML = `<div class="progress"><div class="prog-text" id="ptext">Analysing the game to score it…</div><div class="prog-bar"><div id="pbar" style="width:0%"></div></div></div>`;
    let lastSave = Date.now();
    try {
      evals = await analyseGame(fens, evals, (k, n, ev) => {
        if (!$('#pbar')) throw new Error('cancelled');
        $('#pbar').style.width = `${(k / n) * 100}%`;
        $('#ptext').textContent = `Analysing the game to score it… ${k}/${n}`;
        if (Date.now() - lastSave > 8000) { lastSave = Date.now(); game.evals = ev.map(packEval); store.saveGame(game).catch(() => {}); }
      });
    } catch (e) {
      if (e.message === 'cancelled') return;
      throw e;
    }
    const grades = gradeAll(moves, evals);
    const stats = gameStats(grades, fens, game.hero);
    const perf = performance({ result: game.match.result, heroAcc: stats.heroAcc, botAcc: stats.botAcc });
    const before = m.rating;
    const delta = ratingChange({ rating: before, botLevel: game.match.botLevel, score: perf.score, played: m.games.length });
    m.rating = Math.max(300, before + delta);
    const entry = { id: game.id, at: Date.now(), date: game.date, result: game.match.result, botLevel: game.match.botLevel, heroAcc: stats.heroAcc, botAcc: stats.botAcc, ratingBefore: before, ratingAfter: m.rating, delta, perf, stats, assess: !!game.match.assess };
    m.games.push(entry);
    if (m.games.length > 200) m.games = m.games.slice(-200);
    game.evals = evals.map(packEval);
    game.stats = { accuracy: stats.heroAcc, blunders: stats.blunders, mistakes: stats.mistakes, inaccuracies: stats.inaccuracies };
    Object.assign(game.match, { rated: true, delta, ratingAfter: m.rating, heroAcc: stats.heroAcc, botAcc: stats.botAcc, perf });
    if (game.match.assess) {
      $('#score').innerHTML = `<div class="thinking">Looking closely at your biggest mistakes for the assessment…</div>`;
      const worst = worstMoves(grades, game.hero, 5);
      const mistakes = [];
      for (const g of worst) {
        try {
          const ex = await explainMove({ fenBefore: fens[g.ply - 1], playedUci: moveToUci(moves[g.ply - 1]), hero: game.hero, ply: g.ply, history: moves.slice(0, g.ply - 1) });
          mistakes.push({ ply: g.ply, san: moves[g.ply - 1].san, grade: ex.grade, kind: ex.kind || 'subtle', why: ex.why, best: ex.bestSan, theme: themeForMistake(ex) });
        } catch (e) { if (e.message === 'cancelled') return; }
        if (!$('#score')) return;
      }
      const a = buildAssessment(m, game, mistakes);
      m.assessments.push(a);
      if (m.assessments.length > 30) m.assessments = m.assessments.slice(-30);
      m.focus = a.focus;
      game.match.assessmentIdx = m.assessments.length - 1;
    }
    await saveProgress(p);
    await store.saveGame(game);
  }

  // ---- Show the score --------------------------------------------------
  const g = m.games.find((x) => x.id === game.id) || { ...game.match, ratingAfter: game.match.ratingAfter, stats: null };
  const d = g.delta ?? game.match.delta ?? 0;
  const ha = g.heroAcc ?? game.match.heroAcc, ba = g.botAcc ?? game.match.botAcc;
  const r = game.match.result;
  const better = ha - ba;
  const why = r === 'win'
    ? better >= 5 ? 'You won and outplayed the bot, so your rating goes up properly.' : better <= -5 ? 'You won, but the bot actually played more accurately — a lucky win only moves you up a little.' : 'You won a fairly even game.'
    : r === 'loss'
      ? better >= 5 ? 'You lost, but you played more accurately than the bot — a well-played loss costs you very little.' : better <= -5 ? 'The bot played more accurately this time.' : 'A close game that went the bot’s way.'
      : better >= 5 ? 'A draw where you played the better chess.' : better <= -5 ? 'A draw — the bot played a little more accurately.' : 'A fair draw.';
  $('#score').innerHTML = `
    <div class="pz-stats inline three">
      <div><span class="big">${ha}%</span><small>your accuracy</small></div>
      <div><span class="big">${ba}%</span><small>bot accuracy</small></div>
      <div><span class="big ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</span><small>rating → ${g.ratingAfter ?? m.rating}</small></div>
    </div>
    <p class="why small-why">${esc(why)}</p>
    <div class="actions center-actions">
      <a class="btn primary" href="#/game/${game.id}">Review this game</a>
      <a class="btn" href="#/play">Play again</a>
      ${game.match.assessmentIdx !== undefined ? `<a class="btn" href="#/play/report/${game.match.assessmentIdx}">See your assessment</a>` : ''}
    </div>`;
  const areas = g.stats?.areas;
  if (areas && Object.keys(areas).length) {
    $('#detail').innerHTML = `<h2 class="section-title">This game by phase</h2>${areaTable(areas)}`;
  }
}

function areaTable(areas) {
  return `<div class="card area-table">${Object.entries(AREAS).filter(([k]) => areas[k]).map(([k, a]) => {
    const x = areas[k];
    return `<div class="area-row"><span class="area-name"><b>${esc(a.name)}</b><small>${esc(a.hint)}</small></span>
      <span class="area-bar"><span style="width:${x.acc}%"></span></span>
      <span class="area-num">${x.acc}%<small>${x.errors ? `${x.errors} error${x.errors === 1 ? '' : 's'}` : 'clean'}</small></span></div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Assessment report
// ---------------------------------------------------------------------------
export async function renderAssessment(idx) {
  const p = await loadProgress(C.profile().id);
  const m = matchState(p);
  const a = m.assessments[+idx];
  if (!a) return C.go('play');
  const prev = m.assessments[+idx - 1];
  const W = a.weakest ? AREAS[a.weakest] : null;
  const S = a.strongest ? AREAS[a.strongest] : null;
  const dRating = prev ? a.rating - prev.rating : null;
  const dAcc = prev && prev.overall !== null && a.overall !== null ? a.overall - prev.overall : null;
  const kinds = Object.entries(a.kinds || {}).sort((x, y) => y[1] - x[1]);
  C.app.innerHTML = `${C.topbar('Assessment', '#/play')}
  <main class="page narrow">
    <div class="card">
      <h2 class="card-title">${esc(C.profile().name)}'s assessment</h2>
      <p class="hint">${new Date(a.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · based on ${a.games} game${a.games === 1 ? '' : 's'}</p>
      <div class="pz-stats inline">
        <div><span class="big">${a.rating}</span><small>match rating${dRating !== null ? ` (${dRating >= 0 ? '+' : ''}${dRating} since last)` : ''}</small></div>
        <div><span class="big">${a.overall ?? '–'}%</span><small>average accuracy${dAcc !== null ? ` (${dAcc >= 0 ? '+' : ''}${dAcc})` : ''}</small></div>
      </div>
      ${W ? `<p class="why">Weakest area: <b>${esc(W.name)}</b> (${a.areas[a.weakest].acc}%).${S ? ` Strongest: ${esc(S.name)} (${a.areas[a.strongest].acc}%).` : ''}</p>` : '<p class="hint">Play a few more games for a full picture of each phase.</p>'}
    </div>
    <h2 class="section-title">By phase</h2>
    ${areaTable(a.areas)}
    ${a.mistakes.length ? `<h2 class="section-title">Biggest mistakes in the assessment game</h2>
    <div class="pz-history">${a.mistakes.map((x) => `<a class="pz-row mistake-row" href="#/game/${a.gameId}">
      <span class="pz-mark miss">${x.grade === 'blunder' ? '??' : '?'}</span>
      <span class="pz-row-main"><b>${Math.ceil(x.ply / 2)}. ${esc(x.san)} <span class="muted">— better ${esc(x.best)}</span></b><small>${esc(x.why)}</small></span>
    </a>`).join('')}</div>` : ''}
    ${kinds.length ? `<div class="card"><b>Pattern</b><ul class="kind-list">${kinds.map(([k, n]) => `<li>${esc(MISTAKE_LABEL[k] || k)} <span class="muted">× ${n}</span></li>`).join('')}</ul></div>` : ''}
    <h2 class="section-title">What to practise</h2>
    ${a.focus.length ? `<div class="theme-list">${a.focus.map((t) => `<a class="theme-row" href="#/puzzles/play/${t}"><span class="theme-ico">${THEME[t].icon}</span><span class="theme-main"><b>${esc(THEME[t].name)}</b><small>${esc(THEME[t].blurb)}</small></span><span class="pz-row-go">Practise ›</span></a>`).join('')}</div>
      <p class="hint">These now come first in Today's practice until they're strong.</p>`
      : `<div class="card"><p>No tactical pattern stood out — your mistakes were ${W ? `mostly in the ${esc(W.name.toLowerCase())}` : 'positional'}. Keep playing, and use <b>Why?</b> on flagged moves in review.</p></div>`}
    <div class="actions"><a class="btn primary" href="#/game/${a.gameId}">Review the assessment game</a><a class="btn" href="#/play">Back to Play</a></div>
  </main>`;
}

export { engine };
