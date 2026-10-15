import { Board } from './board.js';
import { engine } from './engine.js';
import { store, prefs, newId, cloudConfigured, migrateLocalToCloud } from './store.js';
import { gameLine, analyseGame, gradeAll, summarise, isFlagged, GRADES, ANALYSIS_VERSION } from './analysis.js';
import { explainMove } from './explain.js';
import { checkIntent, INTENTS, SOUND } from './intent.js';
import { fetchLichessGames } from './lichess.js';
import { Chess, nullMoveFen, nullMoveOk, moveToUci, winPct, scoreFor, toWhitePov, sanOf, describeStanding, playUci } from './chessutil.js';
import { initPuzzles, renderPuzzleHub, renderThemeIntro, renderSession, homePuzzleCard } from './puzzle-ui.js';
import { themeName } from './themes.js';
import { initMatch, renderPlayHub, renderMatchGame, renderMatchResult, renderAssessment, homeMatchCard } from './match-ui.js';
import { initCoach, renderCoach, renderLesson, renderWeakness, homeCoachCard, recordGame } from './coach-ui.js';
import { initLibrary, renderLibrary, renderEntry, renderDrill, homeLibraryCard } from './library-ui.js';
import { entry as libEntry } from './library.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let profile = null;

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
async function route() {
  engine.clearQueue();
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  const [page, arg, arg2] = h.split('/');
  try {
    if (!profile && page !== 'profiles') {
      const id = prefs.get('profile', null);
      const all = await store.listProfiles();
      profile = all.find((p) => p.id === id) || null;
      if (!profile) return go('profiles');
    }
    if (page === 'profiles') return renderProfiles();
    if (page === 'add' && arg === 'pgn') return renderPgn();
    if (page === 'add' && arg === 'board') return renderEnter();
    if (page === 'add' && arg === 'lichess') return renderLichess();
    if (page === 'game' && arg) return renderReview(arg);
    if (page === 'puzzles' && arg === 'theme' && arg2) return renderThemeIntro(arg2);
    if (page === 'puzzles' && arg === 'play' && arg2) return renderSession(arg2);
    if (page === 'puzzles') return renderPuzzleHub();
    if (page === 'play' && arg === 'game') return renderMatchGame();
    if (page === 'play' && arg === 'result' && arg2) return renderMatchResult(arg2);
    if (page === 'play' && arg === 'report' && arg2 !== undefined) return renderAssessment(arg2);
    if (page === 'play') return renderPlayHub();
    if (page === 'coach' && arg === 'learn') return renderLesson();
    if (page === 'coach' && arg === 'w' && arg2) return renderWeakness(arg2);
    if (page === 'coach') return renderCoach();
    if (page === 'library' && arg && arg2 === 'drill') return renderDrill(arg, h.split('/')[3]);
    if (page === 'library' && arg) return renderEntry(arg);
    if (page === 'library') return renderLibrary();
    return renderHome();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="page"><div class="card error"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to start</a></div></div>`;
  }
}
function go(path) {
  location.hash = '#/' + path;
}
window.addEventListener('hashchange', route);

function topbar(title, back = '#/') {
  return `<header class="topbar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">‹</a>` : '<span class="logo">♞</span>'}
    <h1>${esc(title)}</h1>
    ${profile ? `<a class="who-chip" href="#/profiles" title="Switch player">${esc(profile.name)}</a>` : ''}
  </header>`;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
async function renderProfiles() {
  let all = await store.listProfiles();
  if (!all.length) {
    await store.saveProfile({ id: newId(), name: 'Tiago', createdAt: Date.now() });
    all = await store.listProfiles();
  }
  app.innerHTML = `${topbar("Who's playing?", profile ? '#/' : null)}
  <main class="page narrow">
    <div class="profile-list">
      ${all.map((p) => `<button class="profile-btn" data-id="${p.id}"><span class="avatar">${esc(p.name[0] || '?')}</span><span>${esc(p.name)}</span></button>`).join('')}
    </div>
    <form class="card add-profile">
      <label for="pname">Add a player</label>
      <div class="row"><input id="pname" placeholder="Name" maxlength="30" autocomplete="off"><button class="btn">Add</button></div>
      <p class="hint">Each player gets their own games, notes and progress.</p>
    </form>
    <p class="hint center">${cloudConfigured ? 'Saving to the cloud — progress follows you across devices.' : 'Saving on this device for now.'}</p>
  </main>`;
  app.querySelectorAll('.profile-btn').forEach((b) => (b.onclick = () => {
    profile = all.find((p) => p.id === b.dataset.id);
    prefs.set('profile', profile.id);
    go('');
  }));
  $('.add-profile').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#pname').value.trim();
    if (!name) return;
    const p = { id: newId(), name, createdAt: Date.now() };
    await store.saveProfile(p);
    renderProfiles();
  };
}

// ---------------------------------------------------------------------------
// Home: add a game + archive
// ---------------------------------------------------------------------------
function resultFor(g) {
  if (!g.result || g.result === '*') return { text: 'Unfinished', cls: 'draw' };
  if (g.result.startsWith('1/2') || g.result.startsWith('½')) return { text: 'Draw', cls: 'draw' };
  const whiteWon = g.result === '1-0';
  const won = (whiteWon && g.hero === 'w') || (!whiteWon && g.hero === 'b');
  return won ? { text: 'Won', cls: 'won' } : { text: 'Lost', cls: 'lost' };
}

async function renderHome() {
  const games = (await store.listGames(profile.id)).filter((g) => g.source !== 'puzzle');
  const puzzleCard = await homePuzzleCard();
  const matchCard = await homeMatchCard();
  const coachCard = await homeCoachCard();
  const libraryCard = await homeLibraryCard();
  app.innerHTML = `${topbar('Chess Tutor', null)}
  <main class="page narrow">
    ${coachCard}
    ${matchCard}
    ${puzzleCard}
    ${libraryCard}
    <section>
      <h2 class="section-title">Review a game</h2>
      <div class="add-grid">
        <a class="add-btn" href="#/add/board"><span class="add-ico">♟</span><span><b>Replay on the board</b><small>Tap the moves in — for Duolingo or over-the-board games</small></span></a>
        <a class="add-btn" href="#/add/pgn"><span class="add-ico">⎘</span><span><b>Paste a PGN</b><small>The move list most chess apps can copy</small></span></a>
        <a class="add-btn" href="#/add/lichess"><span class="add-ico">⇣</span><span><b>From Lichess</b><small>Pull in your recent games by username</small></span></a>
      </div>
    </section>
    <section>
      <h2 class="section-title">Your games ${games.length ? `<span class="count">${games.length}</span>` : ''}</h2>
      ${games.length ? `<div class="archive">${games.map(gameCard).join('')}</div>` : `<div class="empty">No games yet. Add one above and it'll be kept here so you can come back to it.</div>`}
    </section>
  </main>`;
}

function gameCard(g) {
  const res = resultFor(g);
  const opp = g.hero === 'w' ? g.black : g.white;
  const s = g.stats;
  const flags = s ? [
    s.blunders ? `<span class="pill worst">${s.blunders} blunder${s.blunders > 1 ? 's' : ''}</span>` : '',
    s.mistakes ? `<span class="pill bad">${s.mistakes} mistake${s.mistakes > 1 ? 's' : ''}</span>` : '',
    s.inaccuracies ? `<span class="pill meh">${s.inaccuracies} inaccurac${s.inaccuracies > 1 ? 'ies' : 'y'}</span>` : '',
  ].join('') : '<span class="pill">Not analysed yet</span>';
  return `<a class="game-card" href="#/game/${g.id}">
    <div class="gc-top"><span class="res ${res.cls}">${res.text}</span><b>vs ${esc(opp || 'Opponent')}</b><span class="muted">${esc(g.date || '')}</span></div>
    <div class="gc-bottom">${s && s.accuracy !== null ? `<span class="acc">${s.accuracy}% accuracy</span>` : ''}${flags}${g.explained ? `<span class="pill note">✎ ${g.explained}</span>` : ''}</div>
  </a>`;
}

// ---------------------------------------------------------------------------
// Creating games
// ---------------------------------------------------------------------------
async function createGame({ pgn, hero, source, sourceId }) {
  const { moves, headers } = gameLine(pgn);
  if (!moves.length) throw new Error('That game has no moves in it.');
  const game = {
    id: newId(),
    profileId: profile.id,
    createdAt: Date.now(),
    source,
    sourceId: sourceId || null,
    pgn,
    hero,
    white: headers.White && headers.White !== '?' ? headers.White : hero === 'w' ? profile.name : 'Opponent',
    black: headers.Black && headers.Black !== '?' ? headers.Black : hero === 'b' ? profile.name : 'Opponent',
    result: headers.Result || '*',
    date: headers.Date && !headers.Date.includes('?') ? headers.Date.replace(/\./g, '-') : new Date().toISOString().slice(0, 10),
    moveCount: moves.length,
    evals: [],
    analysisVersion: ANALYSIS_VERSION,
    notes: {},
  };
  game.title = `${game.white} vs ${game.black}`;
  await store.saveGame(game);
  return game;
}

function guessHero(headers) {
  const n = profile.name.toLowerCase();
  const w = (headers.White || '').toLowerCase(), b = (headers.Black || '').toLowerCase();
  if (w && (w.includes(n) || n.includes(w))) return 'w';
  if (b && (b.includes(n) || n.includes(b))) return 'b';
  const lu = (prefs.get('lichess.' + profile.id, '') || '').toLowerCase();
  if (lu && w === lu) return 'w';
  if (lu && b === lu) return 'b';
  return null;
}

function renderPgn() {
  app.innerHTML = `${topbar('Paste a PGN')}
  <main class="page narrow">
    <div class="card">
      <label for="pgn">Paste the game here</label>
      <textarea id="pgn" rows="8" placeholder='[White "You"]&#10;[Black "Opponent"]&#10;&#10;1. e4 e5 2. Nf3 Nc6 ...' spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
      <div id="pgn-info" class="hint">In most apps: open a finished game → Share or Export → Copy PGN.</div>
      <fieldset class="side-pick hidden" id="side">
        <legend>Which side were you?</legend>
        <label><input type="radio" name="hero" value="w"> White</label>
        <label><input type="radio" name="hero" value="b"> Black</label>
      </fieldset>
      <button class="btn primary wide" id="go" disabled>Save and review</button>
    </div>
  </main>`;
  let parsed = null;
  const ta = $('#pgn');
  const check = () => {
    const text = ta.value.trim();
    parsed = null;
    $('#go').disabled = true;
    $('#side').classList.add('hidden');
    if (!text) return ($('#pgn-info').textContent = 'In most apps: open a finished game → Share or Export → Copy PGN.');
    try {
      // Only the first game if several are pasted.
      const first = text.split(/\n\s*\n(?=\[Event )/)[0];
      const { moves, headers } = gameLine(first);
      if (!moves.length) throw new Error('no moves');
      parsed = { pgn: first, headers };
      $('#pgn-info').innerHTML = `<span class="ok">✓ Found ${esc(headers.White || 'White')} vs ${esc(headers.Black || 'Black')}, ${Math.ceil(moves.length / 2)} moves.</span>`;
      $('#side').classList.remove('hidden');
      const g = guessHero(headers);
      if (g) app.querySelector(`input[name=hero][value=${g}]`).checked = true;
      $('#go').disabled = !app.querySelector('input[name=hero]:checked');
    } catch {
      $('#pgn-info').innerHTML = `<span class="warn">That doesn't look like a complete PGN yet. Check you copied the whole thing, including the moves.</span>`;
    }
  };
  ta.addEventListener('input', check);
  app.querySelectorAll('input[name=hero]').forEach((r) => (r.onchange = () => ($('#go').disabled = !parsed)));
  $('#go').onclick = async () => {
    const hero = app.querySelector('input[name=hero]:checked')?.value;
    if (!parsed || !hero) return;
    const g = await createGame({ pgn: parsed.pgn, hero, source: 'pgn' });
    go('game/' + g.id);
  };
}

function renderEnter() {
  const chess = new Chess();
  app.innerHTML = `${topbar('Replay on the board')}
  <main class="page review-layout">
    <div class="board-col">
      <div id="board"></div>
      <div class="nav-row">
        <button class="btn" id="undo">↶ Undo</button>
        <button class="btn" id="flip">⇅ Flip</button>
      </div>
    </div>
    <div class="side-col">
      <div class="card">
        <p class="hint">Play both sides' moves in order: tap a piece, then where it went.</p>
        <div id="moves" class="move-text">No moves yet.</div>
      </div>
      <form class="card" id="details">
        <fieldset class="side-pick"><legend>You played</legend>
          <label><input type="radio" name="hero" value="w" checked> White</label>
          <label><input type="radio" name="hero" value="b"> Black</label>
        </fieldset>
        <label for="opp">Opponent</label>
        <input id="opp" placeholder="e.g. Duolingo, Dad" maxlength="40">
        <label for="res">Result</label>
        <select id="res"><option value="win">I won</option><option value="loss">I lost</option><option value="draw">Draw</option><option value="*" selected>Not finished / not sure</option></select>
        <button class="btn primary wide" id="save" disabled>Save and review</button>
      </form>
    </div>
  </main>`;
  const board = new Board($('#board'), {
    movable: 'both',
    onMove: (uci) => {
      const m = playUci(chess, uci);
      if (!m) return;
      update(m);
    },
  });
  const update = (m) => {
    board.set({ fen: chess.fen(), lastMove: m ? { from: m.from, to: m.to } : null, movable: 'both' });
    const h = chess.history();
    $('#moves').innerHTML = h.length ? h.map((s, i) => (i % 2 === 0 ? `<span class="mn">${i / 2 + 1}.</span>` : '') + `<span>${esc(s)}</span>`).join(' ') : 'No moves yet.';
    $('#save').disabled = h.length === 0;
  };
  $('#undo').onclick = () => { chess.undo(); const h = chess.history({ verbose: true }); update(h[h.length - 1]); };
  $('#flip').onclick = () => board.flip();
  app.querySelectorAll('input[name=hero]').forEach((r) => (r.onchange = () => board.setOrientation(r.value)));
  $('#details').onsubmit = async (e) => {
    e.preventDefault();
    const hero = app.querySelector('input[name=hero]:checked').value;
    const opp = $('#opp').value.trim() || 'Opponent';
    const r = $('#res').value;
    const result = r === 'draw' ? '1/2-1/2' : r === '*' ? '*' : (r === 'win') === (hero === 'w') ? '1-0' : '0-1';
    chess.setHeader('White', hero === 'w' ? profile.name : opp);
    chess.setHeader('Black', hero === 'b' ? profile.name : opp);
    chess.setHeader('Result', result);
    chess.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
    const g = await createGame({ pgn: chess.pgn(), hero, source: 'board' });
    go('game/' + g.id);
  };
}

async function renderLichess() {
  const saved = prefs.get('lichess.' + profile.id, '');
  app.innerHTML = `${topbar('From Lichess')}
  <main class="page narrow">
    <form class="card" id="lf">
      <label for="lu">Your Lichess username</label>
      <div class="row"><input id="lu" value="${esc(saved)}" autocapitalize="off" autocomplete="off" spellcheck="false"><button class="btn primary">Fetch</button></div>
      <p class="hint">Only public games are fetched. No password needed.</p>
    </form>
    <div id="lres"></div>
  </main>`;
  const existing = new Set((await store.listGames(profile.id)).map((g) => g.sourceId).filter(Boolean));
  const fetchNow = async () => {
    const u = $('#lu').value.trim();
    if (!u) return;
    prefs.set('lichess.' + profile.id, u);
    $('#lres').innerHTML = `<div class="card muted">Fetching games…</div>`;
    try {
      const list = await fetchLichessGames(u);
      if (!list.length) return ($('#lres').innerHTML = `<div class="empty">No standard games found for ${esc(u)}.</div>`);
      $('#lres').innerHTML = `<div class="archive">${list.map((g, i) => {
        const res = resultFor(g);
        const opp = g.hero === 'w' ? g.black : g.white;
        return `<div class="game-card"><div class="gc-top"><span class="res ${res.cls}">${res.text}</span><b>vs ${esc(opp)}</b><span class="muted">${esc(g.date)}</span></div>
          <div class="gc-bottom"><span class="muted small">${esc(g.speed || '')}${g.opening ? ' · ' + esc(g.opening) : ''}</span>
          ${existing.has('lichess:' + g.id) ? '<span class="pill">Already saved</span>' : `<button class="btn small" data-i="${i}">Review</button>`}</div></div>`;
      }).join('')}</div>`;
      $('#lres').querySelectorAll('button[data-i]').forEach((b) => (b.onclick = async () => {
        const g = list[+b.dataset.i];
        b.disabled = true;
        const saved = await createGame({ pgn: g.pgn, hero: g.hero, source: 'lichess', sourceId: 'lichess:' + g.id });
        go('game/' + saved.id);
      }));
    } catch (e) {
      $('#lres').innerHTML = `<div class="card error">${esc(e.message || 'Could not reach Lichess.')}</div>`;
    }
  };
  $('#lf').onsubmit = (e) => { e.preventDefault(); fetchNow(); };
  if (saved) fetchNow();
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------
async function renderReview(id) {
  const game = await store.getGame(id);
  if (!game) throw new Error('That game could not be found.');
  const { moves, fens } = gameLine(game.pgn);
  const hero = game.hero;
  const S = {
    game, moves, fens, hero,
    evals: game.analysisVersion === ANALYSIS_VERSION ? (game.evals || []).map(unpackEval) : [],
    grades: [],
    ply: 0,
    exCache: {},
    panel: { layer: 0 }, // 0 quiet, 1 why, 2 more
    mode: 'game', // game | line | recall | intent-follow | intent-worry
    line: null,
    lineIdx: 0,
    analysing: false,
  };

  const isPuzzle = !!game.puzzle;
  app.innerHTML = `${topbar(isPuzzle ? `Puzzle · ${themeName(game.puzzle.theme)}` : game.hero === 'w' ? `vs ${game.black}` : `vs ${game.white}`, isPuzzle ? '#/puzzles' : game.match ? '#/play' : '#/')}
  <main class="page review-layout">
    <div class="board-col">
      <div class="player-strip top" id="ptop"></div>
      <div id="board"></div>
      <div class="player-strip" id="pbot"></div>
      <div class="evalbar" aria-hidden="true"><div class="evalfill" id="evalfill"></div></div>
      <div class="nav-row" id="nav">
        <button class="nbtn" data-a="first" aria-label="Start">⏮</button>
        <button class="nbtn" data-a="prev" aria-label="Previous move">◀</button>
        <button class="nbtn" data-a="next" aria-label="Next move">▶</button>
        <button class="nbtn flag" data-a="nextflag" aria-label="Next flagged move">⚑ ▶</button>
        <button class="nbtn" data-a="flip" aria-label="Flip board">⇅</button>
      </div>
    </div>
    <div class="side-col">
      <div id="progress" class="card progress hidden"></div>
      <div id="summary"></div>
      <div id="movestrip" class="movestrip"></div>
      <div id="panel" class="panel"></div>
      <details class="card more-actions"><summary>${isPuzzle ? 'Options' : 'Game options'}</summary>
        <div class="actions"><button class="btn danger small" id="del">Delete this ${isPuzzle ? 'attempt' : 'game'}</button>
        <button class="btn danger small hidden" id="del-yes">Yes, delete it</button></div>
      </details>
    </div>
  </main>`;

  const board = new Board($('#board'), { orientation: hero, onMove: (uci) => onBoardMove(uci) });
  S.board = board;
  $('#ptop').textContent = hero === 'w' ? game.black : game.white;
  $('#pbot').textContent = hero === 'w' ? game.white : game.black;

  $('#nav').onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (S.mode === 'line') {
      if (a === 'next') S.lineIdx = Math.min(S.line.steps.length, S.lineIdx + 1);
      if (a === 'prev') S.lineIdx = Math.max(0, S.lineIdx - 1);
      if (a === 'first') S.lineIdx = 0;
      if (a === 'flip') board.flip();
      if (a === 'nextflag') S.lineIdx = S.line.steps.length;
      return drawLine();
    }
    if (a === 'flip') return board.flip();
    if (a === 'first') setPly(0);
    if (a === 'prev') setPly(S.ply - 1);
    if (a === 'next') setPly(S.ply + 1);
    if (a === 'nextflag') {
      const n = S.grades.findIndex((g, i) => i + 1 > S.ply && g && g.mover === hero && isFlagged(g));
      if (n >= 0) setPly(n + 1);
      else toast(S.grades.length < moves.length ? 'Still analysing — try again in a moment.' : 'No more flagged moves after this one.');
    }
  };
  // Swipe on the board to step through moves.
  let sx = null;
  $('#board').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $('#board').addEventListener('touchend', (e) => {
    if (sx === null || S.mode !== 'game') return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) setPly(S.ply + (dx < 0 ? 1 : -1));
  });
  document.onkeydown = (e) => {
    if (!$('#nav')) return;
    if (e.key === 'ArrowRight') $('#nav [data-a=next]').click();
    if (e.key === 'ArrowLeft') $('#nav [data-a=prev]').click();
  };
  $('#del').onclick = () => {
    $('#del').textContent = 'Keep it';
    $('#del').classList.remove('danger');
    $('#del-yes').classList.toggle('hidden');
    if ($('#del-yes').classList.contains('hidden')) { $('#del').textContent = 'Delete this game'; $('#del').classList.add('danger'); }
  };
  $('#del-yes').onclick = async () => {
    await store.deleteGame(game);
    go(isPuzzle ? 'puzzles' : '');
  };

  function setPly(p) {
    S.ply = Math.max(0, Math.min(moves.length, p));
    S.mode = 'game';
    S.panel = { layer: 0 };
    drawGame();
    drawPanel();
  }

  function drawGame(extra = {}) {
    const m = S.ply ? moves[S.ply - 1] : null;
    const g = S.ply ? S.grades[S.ply - 1] : null;
    const marks = {};
    if (m && g && isFlagged(g)) marks[m.to] = g.grade;
    else if (m && g && g.grade === 'best' && m.color === hero) marks[m.to] = 'best';
    board.set({ fen: fens[S.ply], lastMove: m ? { from: m.from, to: m.to } : null, arrows: [], movable: null, marks, ...extra });
    drawEval(S.evals[S.ply]);
    drawStrip();
  }

  function drawEval(ev) {
    const fill = $('#evalfill');
    if (!fill) return;
    if (!ev) { fill.style.width = '50%'; fill.parentElement.classList.add('pending'); return; }
    fill.parentElement.classList.remove('pending');
    const w = winPct(scoreFor(ev.score, hero));
    fill.style.width = `${w}%`;
    fill.parentElement.title = `You are ${describeStanding(w)}`;
  }

  function drawStrip() {
    const el = $('#movestrip');
    const parts = [];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const g = S.grades[i];
      const flag = g && isFlagged(g) ? g.grade : '';
      const mine = m.color === hero ? 'mine' : 'theirs';
      if (i % 2 === 0) parts.push(`<span class="mnum">${i / 2 + 1}.</span>`);
      const noted = S.game.notes && S.game.notes[i + 1] ? ' noted' : '';
      parts.push(`<button class="mchip ${mine} ${flag}${S.ply === i + 1 ? ' cur' : ''}${noted}" data-p="${i + 1}">${esc(m.san)}${flag ? `<i>${GRADES[flag].symbol}</i>` : ''}</button>`);
    }
    el.innerHTML = parts.join('');
    el.onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) setPly(+b.dataset.p); };
    const cur = el.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function drawSummary() {
    const s = summarise(S.grades, hero);
    const done = !isPuzzle && S.grades.length === moves.length && S.grades.every(Boolean);
    $('#summary').innerHTML = done ? `<div class="card summary">
      <div class="acc-big">${s.accuracy ?? '–'}<small>% accuracy</small></div>
      <div class="sum-pills">
        <span class="pill worst">${s.blunders} blunder${s.blunders === 1 ? '' : 's'}</span>
        <span class="pill bad">${s.mistakes} mistake${s.mistakes === 1 ? '' : 's'}</span>
        <span class="pill meh">${s.inaccuracies} inaccurac${s.inaccuracies === 1 ? 'y' : 'ies'}</span>
      </div>
      ${s.blunders + s.mistakes + s.inaccuracies ? `<p class="hint">Tap <b>⚑ ▶</b> to jump to each flagged move.</p>` : `<p class="hint">Nothing flagged. Nice game.</p>`}
    </div>` : '';
  }

  // ---- Panel: the layered explanation -----------------------------------
  function drawPanel() {
    const el = $('#panel');
    if (S.ply === 0) {
      el.innerHTML = isPuzzle ? puzzleIntro(game.puzzle) : `<div class="card"><p>Start of the game. Use ▶ or swipe the board to step through, or tap any move above.</p></div>`;
      return;
    }
    const i = S.ply;
    const m = moves[i - 1];
    const g = S.grades[i - 1];
    const mine = m.color === hero;
    const flagged = g && isFlagged(g);
    const note = S.game.notes && S.game.notes[i];
    const head = `<div class="move-head">
      <span class="mnum">${Math.ceil(i / 2)}${m.color === 'w' ? '.' : '…'}</span>
      <b class="msan">${esc(m.san)}</b>
      <span class="who">${mine ? 'your move' : 'their move'}</span>
      ${g ? (flagged || g.grade === 'best' ? `<span class="grade ${GRADES[g.grade].tone}">${GRADES[g.grade].label}</span>` : '') : '<span class="grade pending">checking…</span>'}
    </div>`;
    let body = '';
    const ex = S.exCache[i];
    if (S.panel.layer === 0) {
      body = `<div class="actions">
        <button class="btn ${flagged ? 'primary' : ''}" data-act="why">${flagged ? 'Why?' : mine ? 'Was this good?' : 'Explain this move'}</button>
        ${mine ? `<button class="btn" data-act="intent">I meant that</button>` : ''}
      </div>`;
    } else if (S.panel.layer >= 1 && !ex) {
      body = `<div class="thinking">Looking closer…</div>`;
    } else if (ex) {
      body += `<p class="why">${esc(ex.why)}</p>`;
      if (S.panel.layer === 1) {
        body += `<div class="actions"><button class="btn primary" data-act="more">Tell me more</button>${mine ? `<button class="btn" data-act="intent">I meant that</button>` : ''}</div>`;
      } else if (S.panel.layer === 2 && isFlaggedEx(ex) && !S.panel.revealed) {
        body += `<div class="recall"><p><b>Want to find the better move yourself first?</b></p>
          <div class="actions"><button class="btn primary" data-act="recall">Have a go</button><button class="btn" data-act="reveal">Just show me</button></div></div>`;
      } else {
        body += `<div class="more">${ex.more.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`;
        body += ex.lines.length ? `<div class="lines">${ex.lines.map((l, k) => `<button class="line-btn" data-line="${k}"><span>▶</span> ${esc(l.title)} <small>${esc(l.steps.slice(0, 3).map((s) => s.san).join(' '))}${l.steps.length > 3 ? '…' : ''}</small></button>`).join('')}</div>` : '';
        body += `<div class="actions">${mine ? `<button class="btn" data-act="intent">I meant that</button>` : ''}<button class="btn ghost" data-act="close">Hide</button></div>`;
      }
    }
    if (note && S.mode === 'game') body += noteCard(note);
    el.innerHTML = `<div class="card move-card ${g ? GRADES[g.grade].tone : ''}">${head}${body}</div>`;
    el.onclick = onPanelClick;
    // Board overlays for layer 2: show the position before the move with arrows.
    if (ex && S.panel.layer === 2 && (S.panel.revealed || !isFlaggedEx(ex)) && S.mode === 'game') {
      board.set({ fen: fens[i - 1], lastMove: null, arrows: ex.arrows.filter((a) => a.kind !== 'threat'), marks: {} });
      el.querySelector('.more')?.insertAdjacentHTML('afterbegin', `<p class="board-note">Board shows the position before ${esc(m.san)}: <span class="key played">your move</span> <span class="key best">better move</span></p>`);
    }
  }

  function puzzleIntro(z) {
    const le = z.lib ? libEntry(z.lib) : null;
    const more = le ? `<a href="#/library/${esc(le.id)}">Back to ${esc(le.name)} in the library ›</a>` : `<a href="#/puzzles/theme/${esc(z.theme)}">More ${esc(themeName(z.theme))} puzzles ›</a>`;
    const what = z.kind === 'avoid'
      ? `Stay-safe drill. ${z.firstTry ? 'You stayed out of trouble first time.' : 'This one caught you out.'}${z.bad ? ` The tempting move was <b>${esc(z.bad)}</b>;` : ''} a safe move was <b>${esc((z.solution || []).join(' '))}</b>. Step forward to see what you played.`
      : z.kind === 'threat'
      ? `Spot-the-threat drill. ${z.firstTry ? 'You spotted it and defended first time.' : 'This one caught you out.'} Step forward to see your defence${z.defence ? `; the best defence was <b>${esc(z.defence)}</b>` : ''}.`
      : `${z.firstTry ? 'You solved this first time.' : 'You missed this one.'} Step forward to see ${z.firstTry ? 'your solution' : 'the move you tried'}. The answer was <b>${esc((z.solution || []).join(' '))}</b>.`;
    return `<div class="card"><p>${what}</p><p class="hint">Tap any move for "Why?" and "Tell me more", just like a game. ${more}</p></div>`;
  }

  function isFlaggedEx(ex) {
    return ['inaccuracy', 'mistake', 'blunder'].includes(ex.grade);
  }

  function noteCard(note) {
    return `<div class="note verdict-${note.verdict}">
      <div class="note-head"><b>${esc(note.title)}</b><span class="muted small">You said: ${esc(INTENTS.find((x) => x.id === note.intent)?.label || note.intent)}${note.followSan ? ` (planning ${esc(note.followSan)})` : ''}${note.worrySan ? ` (worried about ${esc(note.worrySan)})` : ''}</span></div>
      ${note.points.map((p) => `<p>${esc(p)}</p>`).join('')}
      ${note.lines && note.lines.length ? `<div class="lines">${note.lines.map((l, k) => `<button class="line-btn" data-nline="${k}"><span>▶</span> ${esc(l.title)}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  async function ensureExplained(i) {
    if (S.exCache[i]) return S.exCache[i];
    const ex = await explainMove({ fenBefore: fens[i - 1], playedUci: moveToUci(moves[i - 1]), hero, ply: i, history: moves.slice(0, i - 1) });
    S.exCache[i] = ex;
    // The closer look can change the grade; keep the strip consistent with it.
    const g = S.grades[i - 1];
    if (g && g.grade !== ex.grade) {
      S.grades[i - 1] = { ...g, grade: ex.grade, loss: ex.loss };
      drawStrip();
      drawSummary();
    }
    return ex;
  }

  async function onPanelClick(e) {
    const b = e.target.closest('[data-act],[data-line],[data-nline],[data-intent],[data-skip]');
    if (!b) return;
    const i = S.ply;
    if (b.dataset.line !== undefined) return startLine(S.exCache[i].lines[+b.dataset.line]);
    if (b.dataset.nline !== undefined) return startLine(S.game.notes[i].lines[+b.dataset.nline]);
    if (b.dataset.intent) return chooseIntent(b.dataset.intent);
    const act = b.dataset.act;
    if (act === 'why') {
      S.panel.layer = 1;
      drawPanel();
      await waitForAnalysisSlot();
      try { await ensureExplained(i); } catch (err) { if (err.message !== 'cancelled') toast('The engine had a problem. Try again.'); }
      if (S.ply === i) drawPanel();
    } else if (act === 'more') {
      S.panel.layer = 2;
      drawPanel();
    } else if (act === 'reveal') {
      S.panel.revealed = true;
      drawPanel();
    } else if (act === 'recall') {
      startRecall();
    } else if (act === 'close') {
      setPly(i);
    } else if (act === 'intent') {
      startIntent();
    } else if (act === 'retry-recall') {
      startRecall();
    } else if (act === 'cancel') {
      setPly(i);
    } else if (act === 'redo-intent') {
      startIntent();
    }
  }

  // ---- Active recall: find the better move ------------------------------
  function startRecall() {
    const i = S.ply;
    const m = moves[i - 1];
    S.mode = 'recall';
    board.set({ fen: fens[i - 1], lastMove: null, arrows: [], marks: {}, movable: m.color });
    scrollToBoard();
    $('#panel').innerHTML = `<div class="card move-card"><p><b>Your turn.</b> This is the position before ${esc(m.san)}. Find a better move on the board.</p>
      <div class="actions"><button class="btn" data-act="reveal-now">Show me the answer</button></div></div>`;
    $('#panel').onclick = (e) => {
      if (e.target.closest('[data-act=reveal-now]')) { S.mode = 'game'; S.panel.revealed = true; drawGame(); drawPanel(); }
    };
  }

  async function checkRecall(uci) {
    const i = S.ply;
    const ex = S.exCache[i];
    const fen = fens[i - 1];
    const m = moves[i - 1];
    const san = sanOf(fen, uci);
    const c = new Chess(fen); const mv = playUci(c, uci);
    board.set({ fen: c.fen(), lastMove: { from: mv.from, to: mv.to }, movable: null });
    $('#panel').innerHTML = `<div class="card move-card"><div class="thinking">Checking ${esc(san)}…</div></div>`;
    let verdict;
    if (uci === ex.bestUci) verdict = 'best';
    else if (uci === moveToUci(m)) verdict = 'same';
    else {
      const r = await engine.analyse(fen, { depth: 14, searchmoves: [uci] });
      const l = r.lines[0];
      const sTry = scoreFor(toWhitePov(l, fen), m.color);
      const tryPct = winPct(sTry);
      const bestPct = ex.wb;
      verdict = bestPct - tryPct < SOUND ? 'good' : 'no';
      S.recallStanding = describeStanding(tryPct);
    }
    const msg = {
      best: `<b>Yes — ${esc(san)} is exactly the engine's choice.</b>`,
      good: `<b>Good find — ${esc(san)} works too.</b> It's about as strong as the engine's top move, ${esc(ex.bestSan)}.`,
      same: `That's the move from the game. Try something different.`,
      no: `<b>Not quite.</b> After ${esc(san)} you'd be ${esc(S.recallStanding || '')}. Have another go?`,
    }[verdict];
    const done = verdict === 'best' || verdict === 'good';
    $('#panel').innerHTML = `<div class="card move-card ${done ? 'good' : ''}"><p>${msg}</p><div class="actions">
      ${done ? '<button class="btn primary" data-act="reveal-now">See the full explanation</button>' : '<button class="btn primary" data-act="retry">Try again</button><button class="btn" data-act="reveal-now">Show me</button>'}</div></div>`;
    $('#panel').onclick = (e) => {
      if (e.target.closest('[data-act=retry]')) startRecall();
      if (e.target.closest('[data-act=reveal-now]')) { S.mode = 'game'; S.panel = { layer: 2, revealed: true }; drawGame(); drawPanel(); }
    };
  }

  // ---- Playing through a line -------------------------------------------
  function startLine(line) {
    if (!line || !line.steps.length) return;
    S.mode = 'line';
    S.line = line;
    S.lineIdx = 1;
    drawLine();
  }

  function drawLine() {
    const l = S.line;
    const step = S.lineIdx ? l.steps[S.lineIdx - 1] : null;
    const fen = step ? step.fen : l.fen;
    board.set({ fen, lastMove: step ? { from: step.move.from, to: step.move.to } : null, arrows: [], marks: {}, movable: null });
    $('#panel').innerHTML = `<div class="card move-card line-card">
      <div class="move-head"><b>${esc(l.title)}</b><span class="who">${S.lineIdx}/${l.steps.length}</span></div>
      <div class="line-moves">${l.steps.map((s, k) => `<button class="mchip ${k + 1 === S.lineIdx ? 'cur' : ''}" data-ls="${k + 1}">${esc(s.san)}</button>`).join('')}</div>
      <p class="why">${step ? esc(step.text) : 'Starting position for this line. Tap ▶ to step through.'}</p>
      <div class="actions"><button class="btn" data-act="lprev">◀</button><button class="btn primary" data-act="lnext">▶</button><button class="btn ghost" data-act="back">Back to the game</button></div>
    </div>`;
    $('#panel').onclick = (e) => {
      const ls = e.target.closest('[data-ls]');
      if (ls) { S.lineIdx = +ls.dataset.ls; return drawLine(); }
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'lnext') { S.lineIdx = Math.min(l.steps.length, S.lineIdx + 1); drawLine(); }
      if (a === 'lprev') { S.lineIdx = Math.max(0, S.lineIdx - 1); drawLine(); }
      if (a === 'back') { S.mode = 'game'; drawGame(); drawPanel(); }
    };
  }

  // ---- "I meant that" ------------------------------------------------------
  function startIntent() {
    S.mode = 'intent-pick';
    S.intent = {};
    drawGame();
    $('#panel').innerHTML = `<div class="card move-card"><p><b>What were you going for with ${esc(moves[S.ply - 1].san)}?</b></p>
      <div class="intent-grid">${INTENTS.map((x) => `<button class="intent-btn" data-intent="${x.id}">${esc(x.label)}</button>`).join('')}</div>
      <div class="actions"><button class="btn ghost" data-act="cancel">Cancel</button></div></div>`;
    $('#panel').onclick = onPanelClick;
  }

  function chooseIntent(id) {
    const def = INTENTS.find((x) => x.id === id);
    const i = S.ply;
    const m = moves[i - 1];
    S.intent = { intent: id };
    if (def.ask === 'follow' && nullMoveOk(fens[i])) {
      S.mode = 'intent-follow';
      board.set({ fen: nullMoveFen(fens[i]), lastMove: { from: m.from, to: m.to }, movable: m.color, arrows: [], marks: {} });
      scrollToBoard();
      $('#panel').innerHTML = `<div class="card move-card"><p><b>Show me the follow-up you had in mind.</b> Imagine your opponent did nothing — tap the move you wanted to play next.</p>
        <div class="actions"><button class="btn" data-skip="1">I didn't have a specific move</button><button class="btn ghost" data-act="cancel">Cancel</button></div></div>`;
      $('#panel').onclick = (e) => { if (e.target.closest('[data-skip]')) runIntent(); else onPanelClick(e); };
    } else if (def.ask === 'worry' && nullMoveOk(fens[i - 1])) {
      S.mode = 'intent-worry';
      board.set({ fen: nullMoveFen(fens[i - 1]), lastMove: null, movable: m.color === 'w' ? 'b' : 'w', arrows: [], marks: {} });
      scrollToBoard();
      $('#panel').innerHTML = `<div class="card move-card"><p><b>Which move were you worried about?</b> This is the position before your move — tap the opponent's move you wanted to stop.</p>
        <div class="actions"><button class="btn" data-skip="1">Not sure — you work it out</button><button class="btn ghost" data-act="cancel">Cancel</button></div></div>`;
      $('#panel').onclick = (e) => { if (e.target.closest('[data-skip]')) runIntent(); else onPanelClick(e); };
    } else {
      runIntent();
    }
  }

  async function runIntent() {
    const i = S.ply;
    const m = moves[i - 1];
    S.mode = 'intent-run';
    drawGame();
    $('#panel').innerHTML = `<div class="card move-card"><div class="thinking">Testing your idea… this takes a few seconds.</div></div>`;
    try {
      await waitForAnalysisSlot();
      const ex = await ensureExplained(i);
      const res = await checkIntent({
        fenBefore: fens[i - 1], playedUci: moveToUci(m), hero, ply: i, history: moves.slice(0, i - 1),
        intent: S.intent.intent, followUci: S.intent.follow || null, worryUci: S.intent.worry || null, explanation: ex,
      });
      const note = {
        intent: S.intent.intent,
        followUci: S.intent.follow || null,
        followSan: S.intent.follow ? sanOf(nullMoveFen(fens[i]), S.intent.follow) : null,
        worryUci: S.intent.worry || null,
        worrySan: S.intent.worry ? sanOf(nullMoveFen(fens[i - 1]), S.intent.worry) : null,
        verdict: res.verdict,
        title: res.title,
        points: res.points,
        lines: res.lines.map(slimLine),
        at: Date.now(),
      };
      S.game.notes = S.game.notes || {};
      S.game.notes[i] = note;
      await store.saveGame(S.game);
      S.mode = 'game';
      S.panel = { layer: 0 };
      drawGame();
      drawPanel();
    } catch (err) {
      if (err.message === 'cancelled') return;
      console.error(err);
      $('#panel').innerHTML = `<div class="card error"><p>Couldn't test that: ${esc(err.message)}</p><button class="btn" data-act="cancel">Back</button></div>`;
      $('#panel').onclick = onPanelClick;
    }
  }

  function onBoardMove(uci) {
    if (S.mode === 'recall') return checkRecall(uci);
    if (S.mode === 'intent-follow') { S.intent.follow = uci; return runIntent(); }
    if (S.mode === 'intent-worry') { S.intent.worry = uci; return runIntent(); }
  }

  // ---- Background analysis ----------------------------------------------
  // Explanations take priority: the whole-game pass pauses while one runs.
  let paused = null;
  async function waitForAnalysisSlot() {
    if (!S.analysing) return;
    await new Promise((r) => (paused = r));
  }

  async function runAnalysis() {
    const need = fens.length;
    if (S.evals.filter(Boolean).length >= need) {
      S.grades = gradeAll(moves, S.evals);
      afterAnalysis();
      return;
    }
    S.analysing = true;
    const prog = $('#progress');
    prog.classList.remove('hidden');
    let lastSave = Date.now();
    try {
      for (let k = 0; k < need; k++) {
        if (!document.body.contains(prog)) return; // left the page
        if (!S.evals[k]) {
          const { evalPosition } = await import('./analysis.js');
          S.evals[k] = await evalPosition(fens[k]);
        }
        prog.innerHTML = `<div class="prog-text">Analysing the game… ${k + 1}/${need}</div><div class="prog-bar"><div style="width:${((k + 1) / need) * 100}%"></div></div>`;
        if (k >= 1) S.grades[k - 1] = gradeAll(moves.slice(0, k), S.evals.slice(0, k + 1))[k - 1];
        if (k === S.ply) drawEval(S.evals[k]);
        if (k >= 1 && (k === S.ply || k % 4 === 0)) { drawStrip(); if (k === S.ply) drawPanel(); }
        if (paused) { const r = paused; paused = null; S.analysing = false; r(); await idle(); S.analysing = true; }
        if (Date.now() - lastSave > 8000) { await saveEvals(); lastSave = Date.now(); }
      }
    } catch (e) {
      if (e.message === 'cancelled') return;
      throw e;
    } finally {
      S.analysing = false;
      if (paused) { paused(); paused = null; }
    }
    S.grades = gradeAll(moves, S.evals);
    await saveEvals();
    prog.classList.add('hidden');
    afterAnalysis();
  }

  // Wait until the engine has no explanation jobs in flight.
  async function idle() {
    while (engine.busy || engine.queue.length) await new Promise((r) => setTimeout(r, 150));
  }

  async function saveEvals() {
    S.game.evals = S.evals.map(packEval);
    S.game.analysisVersion = ANALYSIS_VERSION;
    if (S.grades.length === moves.length && S.grades.every(Boolean)) S.game.stats = summarise(S.grades, hero);
    try { await store.saveGame(S.game); } catch (e) { toast(e.message); }
  }

  function afterAnalysis() {
    drawStrip();
    drawSummary();
    drawPanel();
    // Feed the curriculum (Pillar 4) once the whole game is analysed.
    if (!isPuzzle) {
      recordGame(S.game, { moves, fens }, S.evals)
        .then((msgs) => msgs.forEach((m) => toast(m.text)))
        .catch((e) => console.warn('Curriculum:', e.message));
    }
  }

  // Deep link to a move, e.g. from a curriculum example: #/game/<id>?ply=12
  const askPly = +(new URLSearchParams(location.hash.split('?')[1] || '').get('ply') || 0);
  if (askPly > 0) S.ply = Math.min(moves.length, askPly);

  drawGame();
  drawPanel();
  runAnalysis().catch((e) => { console.error(e); toast('Analysis stopped: ' + e.message); });
}

// On a phone the board and the panel don't fit on one screen; bring the board
// into view when the player needs to make a move on it.
function scrollToBoard() {
  const b = $('#board');
  if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function slimLine(l) {
  return { title: l.title, fen: l.fen, steps: l.steps.map((s) => ({ san: s.san, fen: s.fen, text: s.text, move: { from: s.move.from, to: s.move.to } })) };
}

function packEval(e) {
  if (!e) return null;
  return { s: e.score, b: e.best, p: (e.pv || []).slice(0, 6), d: e.depth };
}
function unpackEval(e) {
  if (!e) return null;
  return { score: e.s, best: e.b, pv: e.p || [], depth: e.d };
}

initPuzzles({ app, $, esc, topbar, go, toast: (m) => toast(m), profile: () => profile });
initMatch({ app, $, esc, topbar, go, toast: (m) => toast(m), profile: () => profile });
initCoach({ app, $, esc, topbar, go, toast: (m) => toast(m), profile: () => profile });
initLibrary({ app, $, esc, topbar, go, toast: (m) => toast(m), profile: () => profile });

let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---------------------------------------------------------------------------
(async () => {
  if (cloudConfigured) {
    try { const n = await migrateLocalToCloud(); if (n) toast(`Moved ${n} saved game${n > 1 ? 's' : ''} to the cloud.`); } catch (e) { console.warn(e); }
  }
  engine.start().catch(() => toast("The analysis engine couldn't start in this browser."));
  route();
})();
