// Puzzle bank, selection, puzzle rating, spaced repetition and the daily streak.
// Puzzles come from the Lichess puzzle database (CC0): a starter pack ships
// with the app, and more are fetched from Lichess when a theme runs low.
import { THEMES, THEME } from './themes.js';
import { cache, getProgress, saveProgress } from './store.js';
import { Chess, nullMoveOk, playUci } from './chessutil.js';
import { dailyThemes } from './curriculum.js';

export const SET_SIZE = 6;
const DAY = 86400000;
const PUZZLE_STEPS = [1, 3, 7, 16, 35]; // days between re-tests of a missed puzzle
const THEME_STEPS = [3, 7, 14, 30, 60]; // days before a strong theme gets a refresher

export const LEVELS = [
  { id: 'new', label: 'Just learning the moves', rating: 600 },
  { id: 'basics', label: 'Knows the basics', rating: 850 },
  { id: 'regular', label: 'Plays regularly', rating: 1050 },
  { id: 'club', label: 'Strong club player', rating: 1400 },
];

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function addDays(n) {
  return startOfDay() + n * DAY + 4 * 3600000; // 4am on that day, so it's due "that morning"
}

// ---------------------------------------------------------------------------
// Progress record
// ---------------------------------------------------------------------------
export function blankProgress(profileId) {
  return {
    profileId,
    rating: null, // set by the level question on first visit
    rated: 0, // puzzles that have counted towards the rating
    streak: { current: 0, best: 0, lastDay: null },
    days: {}, // dayKey -> puzzles done that day
    themes: {}, // id -> { attempts, solved, recent: [1,0,...], strong, step, due, lastAt }
    puzzles: {}, // id -> { theme, step, due, n, fails, last, d? }
  };
}

export async function loadProgress(profileId) {
  const p = (await getProgress(profileId)) || blankProgress(profileId);
  p.streak = p.streak || { current: 0, best: 0, lastDay: null };
  p.days = p.days || {};
  p.themes = p.themes || {};
  p.puzzles = p.puzzles || {};
  return p;
}

export function streakInfo(p) {
  const s = p.streak || {};
  const today = dayKey();
  const yesterday = dayKey(Date.now() - DAY);
  const alive = s.lastDay === today || s.lastDay === yesterday;
  return {
    current: alive ? s.current || 0 : 0,
    best: s.best || 0,
    doneToday: s.lastDay === today,
    todayCount: p.days[today] || 0,
  };
}

function bumpStreak(p) {
  const today = dayKey();
  const s = p.streak;
  if (s.lastDay === today) return;
  s.current = s.lastDay === dayKey(Date.now() - DAY) ? (s.current || 0) + 1 : 1;
  s.best = Math.max(s.best || 0, s.current);
  s.lastDay = today;
}

export function themeState(p, id) {
  const t = p.themes[id];
  if (!t || !t.attempts) return { key: 'new', label: 'New', pct: 0 };
  const recent = t.recent || [];
  const pct = recent.length ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 100) : 0;
  if (t.strong && t.due && t.due <= Date.now()) return { key: 'due', label: 'Refresher due', pct };
  if (t.strong) return { key: 'strong', label: 'Strong', pct };
  return { key: 'learning', label: `Learning · ${pct}%`, pct };
}

export function duePuzzles(p) {
  const now = Date.now();
  return Object.entries(p.puzzles).filter(([, x]) => x.due && x.due <= now).map(([id, x]) => ({ id, ...x }));
}

export function dueThemes(p) {
  return THEMES.filter((t) => themeState(p, t.id).key === 'due').map((t) => t.id);
}

// Record one finished item. `result` = { id, theme, kind, firstTry, rating, data }.
export function recordResult(p, result) {
  const now = Date.now();
  const ok = result.firstTry ? 1 : 0;
  // Theme stats
  const t = p.themes[result.theme] || (p.themes[result.theme] = { attempts: 0, solved: 0, recent: [], strong: false, step: 0, due: null });
  t.attempts++;
  t.solved += ok;
  t.recent = [...(t.recent || []), ok].slice(-12);
  t.lastAt = now;
  // Puzzle rating (solving puzzles only, first time seen).
  const seen = p.puzzles[result.id];
  let delta = 0;
  if (result.kind === 'solve' && !seen && result.rating && p.rating) {
    const exp = 1 / (1 + Math.pow(10, (result.rating - p.rating) / 400));
    const k = p.rated < 20 ? 40 : 24;
    delta = Math.round(k * (ok - exp));
    p.rating = Math.max(300, p.rating + delta);
    p.rated++;
  }
  // Spaced repetition: missed puzzles come back tomorrow, then at growing gaps.
  const e = seen || { theme: result.theme, step: -1, n: 0, fails: 0 };
  e.n++;
  e.last = now;
  e.kind = result.kind;
  if (result.data) e.d = result.data; // keep fetched puzzles so they can be re-tested
  if (!ok) {
    e.fails++;
    e.step = 0;
    e.due = addDays(PUZZLE_STEPS[0]);
  } else if (seen && seen.due) {
    e.step = (seen.step || 0) + 1;
    e.due = e.step < PUZZLE_STEPS.length ? addDays(PUZZLE_STEPS[e.step]) : null; // learned: retire
  } else {
    e.due = null;
  }
  p.puzzles[result.id] = e;
  // Day count + streak
  const today = dayKey();
  p.days[today] = (p.days[today] || 0) + 1;
  for (const k of Object.keys(p.days)) if (now - Date.parse(k) > 90 * DAY) delete p.days[k];
  bumpStreak(p);
  return delta;
}

// After a set: decide whether each practised theme is strong, and when it
// should come back for a refresher.
export function finishSet(p, themeIds) {
  for (const id of new Set(themeIds)) {
    const t = p.themes[id];
    if (!t) continue;
    const r = t.recent || [];
    const pct = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
    if (r.length >= 8 && pct >= 0.75) {
      t.step = t.strong ? Math.min((t.step || 0) + 1, THEME_STEPS.length - 1) : 0;
      t.strong = true;
      t.due = addDays(THEME_STEPS[t.step]);
    } else {
      if (t.strong && pct < 0.6) t.strong = false; // it has faded: back to learning
      t.step = 0;
      t.due = t.strong ? addDays(THEME_STEPS[0]) : null;
    }
  }
}

export { saveProgress };

// ---------------------------------------------------------------------------
// Puzzle bank
// ---------------------------------------------------------------------------
let packPromise = null;
export function loadPack() {
  if (!packPromise) {
    packPromise = fetch(new URL('../data/puzzles.json', import.meta.url))
      .then((r) => { if (!r.ok) throw new Error('Puzzle pack missing'); return r.json(); })
      .catch((e) => { packPromise = null; throw e; });
  }
  return packPromise;
}

function liveKey(theme) { return 'live.' + theme; }

async function pool(theme) {
  const pack = await loadPack();
  const base = (pack.themes[theme] || []).map((x) => ({ ...x, theme }));
  const live = (cache.get(liveKey(theme), []) || []).map((x) => ({ ...x, theme, live: true }));
  const seen = new Set(base.map((x) => x.id));
  return base.concat(live.filter((x) => !seen.has(x.id)));
}

// Fetch more puzzles for a theme from Lichess, near this rating.
export async function fetchMore(theme, rating) {
  const diff = rating < 1000 ? 'easiest' : rating < 1350 ? 'easier' : 'normal';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`https://lichess.org/api/puzzle/batch/${theme}?nb=30&difficulty=${diff}`, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(r.status === 429 ? 'Lichess is busy — try again in a minute.' : `Lichess said ${r.status}`);
    const j = await r.json();
    const got = j.puzzles.map(fromLichess).filter(Boolean);
    const old = cache.get(liveKey(theme), []) || [];
    const ids = new Set(old.map((x) => x.id));
    const merged = old.concat(got.filter((x) => !ids.has(x.id))).slice(-300);
    cache.set(liveKey(theme), merged);
    return got.length;
  } finally {
    clearTimeout(timer);
  }
}

const SKIP_TAGS = new Set(['short', 'long', 'veryLong', 'oneMove', 'middlegame', 'endgame', 'opening', 'crushing', 'advantage', 'mate', 'master', 'masterVsMaster', 'superGM']);
function fromLichess(it) {
  const c = new Chess();
  const mv = it.game.pgn.split(' ');
  try {
    for (let i = 0; i < mv.length - 1; i++) c.move(mv[i]);
    const fen = c.fen();
    const m = c.move(mv[mv.length - 1]);
    const p = it.puzzle;
    return { id: p.id, fen, last: m.from + m.to + (m.promotion || ''), sol: p.solution, r: p.rating, t: p.themes.filter((x) => !SKIP_TAGS.has(x)) };
  } catch {
    return null;
  }
}

// Position the player faces (after the opponent's last move).
export function startFen(pz) {
  const c = new Chess(pz.fen);
  playUci(c, pz.last);
  return c.fen();
}

// Can this puzzle be turned round into a "spot the threat" drill?
export function threatOk(pz) {
  try { return nullMoveOk(startFen(pz)); } catch { return false; }
}

function pickNear(list, target, n, avoid) {
  const out = [];
  const sorted = list.filter((x) => !avoid.has(x.id)).sort((a, b) => Math.abs(a.r - target) - Math.abs(b.r - target));
  // Some variety: shuffle within the closest few.
  const window = sorted.slice(0, Math.max(n * 3, 8));
  while (out.length < n && window.length) out.push(window.splice(Math.floor(Math.random() * window.length), 1)[0]);
  return out;
}

// Pick `n` puzzles from a theme the player hasn't seen, pitched at their level.
export async function pickFromTheme(p, theme, n, avoid = new Set()) {
  const R = p.rating || 1000;
  const target = R - 50; // a little below rating: aim for ~55-60% success
  let list = await pool(theme);
  const unseen = (l) => l.filter((x) => !p.puzzles[x.id] && !avoid.has(x.id));
  const inRange = (l) => unseen(l).filter((x) => x.r >= R - 350 && x.r <= R + 250);
  if (inRange(list).length < n) {
    try { await fetchMore(theme, R); list = await pool(theme); } catch (e) { console.warn(e); }
  }
  let picks = pickNear(inRange(list), target, n, avoid);
  if (picks.length < n) picks = picks.concat(pickNear(unseen(list), target, n - picks.length, new Set([...avoid, ...picks.map((x) => x.id)])));
  if (picks.length < n) {
    // Everything seen: re-use the ones done longest ago.
    const used = new Set([...avoid, ...picks.map((x) => x.id)]);
    const old = list.filter((x) => !used.has(x.id)).sort((a, b) => (p.puzzles[a.id]?.last || 0) - (p.puzzles[b.id]?.last || 0));
    picks = picks.concat(old.slice(0, n - picks.length));
  }
  return picks;
}

async function findPuzzle(p, id, theme) {
  const saved = p.puzzles[id];
  if (saved && saved.d) return { ...saved.d, theme };
  const list = await pool(theme);
  return list.find((x) => x.id === id) || null;
}

// Mix "find the move" and "spot the threat" items: solve, solve, threat, ...
function arrange(solveList, threatList) {
  const out = [];
  const pattern = ['solve', 'solve', 'threat', 'solve', 'threat', 'solve', 'solve', 'threat'];
  let s = 0, t = 0;
  for (const k of pattern) {
    if (k === 'threat' && threatList[t]) out.push({ kind: 'threat', p: threatList[t++] });
    else if (solveList[s]) out.push({ kind: 'solve', p: solveList[s++] });
  }
  while (s < solveList.length) out.push({ kind: 'solve', p: solveList[s++] });
  return out;
}

// A themed set.
export async function buildThemeSet(p, theme, size = SET_SIZE) {
  const nThreat = 2;
  const picks = await pickFromTheme(p, theme, size + 3);
  const threats = picks.filter(threatOk).slice(0, nThreat);
  const tIds = new Set(threats.map((x) => x.id));
  const solves = picks.filter((x) => !tIds.has(x.id)).slice(0, size - threats.length);
  return { mode: 'theme', theme, items: arrange(solves, threats) };
}

// A curriculum set (Pillar 4): one theme, weighted to the side being trained.
// kind 'threat' = mostly spot-the-threat (defending); 'solve' = mostly find-the-move.
export async function buildCurriculumSet(p, theme, kind, size = SET_SIZE) {
  const nThreat = kind === 'threat' ? Math.ceil(size * 0.67) : 1;
  const picks = await pickFromTheme(p, theme, size + nThreat + 4);
  const threats = picks.filter(threatOk).slice(0, nThreat);
  const tIds = new Set(threats.map((x) => x.id));
  const solves = picks.filter((x) => !tIds.has(x.id)).slice(0, size - threats.length);
  const items = kind === 'threat'
    ? shuffle([...threats.map((x) => ({ kind: 'threat', p: x })), ...solves.map((x) => ({ kind: 'solve', p: x }))])
    : arrange(solves, threats);
  return { mode: 'curriculum', theme, items: items.slice(0, size) };
}

// Today's practice: missed puzzles that are due, refreshers for themes that
// are fading, then the theme that needs the most work.
export async function buildDailySet(p, size = 8) {
  const items = [];
  const used = new Set();
  for (const d of duePuzzles(p).sort((a, b) => a.due - b.due).slice(0, 3)) {
    const pz = await findPuzzle(p, d.id, d.theme);
    if (pz) { items.push({ kind: d.kind === 'threat' && threatOk(pz) ? 'threat' : 'solve', p: pz, review: true }); used.add(pz.id); }
  }
  const focus = [];
  // The curriculum's current weakness and any due re-tests come first (Pillar 4).
  for (const id of dailyThemes(p)) focus.push(id);
  for (const id of dueThemes(p)) if (!focus.includes(id)) focus.push(id);
  // Themes the last assessment match pointed at (Pillar 3) come next.
  for (const id of (p.match && p.match.focus) || []) if (THEME[id] && !focus.includes(id) && !p.themes[id]?.strong) focus.push(id);
  const practised = THEMES.filter((t) => p.themes[t.id]?.attempts && !p.themes[t.id].strong)
    .sort((a, b) => themeState(p, a.id).pct - themeState(p, b.id).pct)
    .map((t) => t.id);
  for (const id of practised) if (!focus.includes(id)) focus.push(id);
  const fresh = THEMES.find((t) => !p.themes[t.id]?.attempts);
  if (fresh && focus.length < 2) focus.push(fresh.id);
  if (!focus.length) focus.push(THEMES[Math.floor(Math.random() * THEMES.length)].id);
  const themes = focus.slice(0, 3);
  const need = size - items.length;
  const per = Math.ceil(need / themes.length);
  const solves = [], threats = [];
  for (const th of themes) {
    const picks = await pickFromTheme(p, th, per + 1, used);
    picks.forEach((x) => used.add(x.id));
    const t = threats.length < 2 ? picks.find(threatOk) : null;
    if (t) threats.push(t);
    solves.push(...picks.filter((x) => x !== t).slice(0, per - (t ? 1 : 0)));
  }
  items.push(...arrange(shuffle(solves), threats).slice(0, need));
  return { mode: 'daily', theme: null, items };
}

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export { THEMES, THEME };
