// Pillar 4: the diagnostic curriculum.
// Every analysed game is turned into evidence (which tactics the player walked
// into, which they missed), puzzles add their own evidence, and the weaknesses
// are ranked. The player then works on one at a time:
//   learn (how it works, with positions from their own games)
//   → drill (focused puzzle sets)
//   → verify (a spaced check-up set + it stops happening in later games)
//   → mastered (re-tested at growing gaps; back on the list if it fades).
import { gradeAll } from './analysis.js';
import { Chess, scoreFor, materialSwing, moveToUci } from './chessutil.js';
import { classifyTactic } from './motifs.js';
import { THEME } from './themes.js';

const DAY = 86400000;
export const RETEST_STEPS = [7, 21, 45, 90, 180]; // days between re-tests once mastered
const WINDOW = 20; // games looked at for the diagnosis
const CHECKUP_GAP = 2; // days after drilling before the check-up set
const VERIFY_GAMES = 3;

// ---------------------------------------------------------------------------
// The weaknesses: one per puzzle theme and side.
//   missed  = you had it and didn't play it  → find-the-move puzzles
//   allowed = your opponent had it after your move → spot-the-threat puzzles
// ---------------------------------------------------------------------------
const TEXT = {
  hangingPiece: {
    missed: ['Taking free pieces', 'Your opponent left something unprotected and you didn\'t take it.'],
    allowed: ['Leaving pieces unprotected', 'You left a piece where it could be taken for free.'],
    attack: 'After every opponent move, ask: what did that move stop defending? Then check every capture you have — the free ones are often the ones you don\'t look at.',
    defend: 'Before you let go of a piece, look at the square it lands on and the square it left. Is anything of yours now attacked more times than it\'s defended?',
  },
  fork: {
    missed: ['Finding your forks', 'You had a move that attacked two things at once.'],
    allowed: ['Seeing their forks coming', 'Your move let a piece attack two of yours at once.'],
    attack: 'Look for squares where one of your pieces would attack two targets — especially the king plus something loose. Knight forks hide well: check every square your knights can reach.',
    defend: 'Watch for your king and another piece (or two loose pieces) sitting a knight\'s jump, or a queen\'s line, apart. If one enemy piece could hit both, fix it before it happens.',
  },
  pin: {
    missed: ['Using pins', 'You could have pinned a piece to something more valuable behind it.'],
    allowed: ['Walking into pins', 'Your move let a piece get pinned to something more valuable.'],
    attack: 'When two of their pieces stand on one line, with the more valuable one behind, a bishop, rook or queen on that line pins the front one. Then attack the pinned piece again — it can\'t run.',
    defend: 'Be careful lining your king or queen up behind another piece on an open line or diagonal. Step out of the line before they put a bishop or rook on it.',
  },
  skewer: {
    missed: ['Using skewers', 'You could have attacked a big piece so the one behind it fell.'],
    allowed: ['Walking into skewers', 'Your move let them attack a big piece and win the one behind it.'],
    attack: 'Look for their king or queen with another piece behind it on the same line. Check it or attack it along that line: when it moves, take what\'s behind.',
    defend: 'Don\'t leave your king or queen in front of an undefended piece on an open line. Defend the back piece or move one of them off the line.',
  },
  discoveredAttack: {
    missed: ['Using discovered attacks', 'Moving one piece would have uncovered an attack by another.'],
    allowed: ['Seeing discovered attacks coming', 'Your move let them move a piece aside and unleash an attack behind it.'],
    attack: 'When one of your pieces stands between your bishop, rook or queen and an enemy target, moving it reveals that attack — and the moving piece can make its own threat too.',
    defend: 'Look at the lines their bishops, rooks and queen point down. If only one of their own pieces is in the way, ask what happens when it moves — especially with check.',
  },
  mateIn1: {
    missed: ['Spotting mate in one', 'You had checkmate in one move.'],
    allowed: ['Seeing mate threats', 'Your move let them checkmate you straight away.'],
    attack: 'Look at every check you have, every move. Checkmate needs all three escapes shut: the king can\'t move, nothing can block, and the checker can\'t be taken.',
    defend: 'Before each move, look at every check your opponent would have afterwards. If any of them is mate, deal with it first.',
  },
  mateIn2: {
    missed: ['Finding forced mates', 'You had a forced checkmate in a few moves.'],
    allowed: ['Seeing mating attacks coming', 'Your move let them force checkmate.'],
    attack: 'Forced mates start with forcing moves: checks first, then captures, then threats. Don\'t skip a check just because it gives up material.',
    defend: 'When their pieces gather near your king, count attackers and defenders. Bring a defender back or make an escape square before they get there.',
  },
  backRankMate: {
    missed: ['Finishing on the back rank', 'Their king was stuck behind its pawns and you could have mated it.'],
    allowed: ['Guarding your back rank', 'Your king was stuck behind its own pawns and they could mate it.'],
    attack: 'A king hemmed in by its own pawns dies to a rook or queen landing on its back rank. Check whether anything still guards that rank — if not, go for it.',
    defend: 'Once you\'ve castled, give your king a square: one quiet pawn move (h3 or g3, h6 or g6) is often enough. And don\'t pull your last rook off the back rank carelessly.',
  },
  promotion: {
    missed: ['Pushing pawns through', 'You could have promoted a pawn, or cleared its way.'],
    allowed: ['Stopping passed pawns', 'Your move let one of their pawns run through to promote.'],
    attack: 'Far-advanced pawns are worth more than they look. Count: can they stop it? If the blocker can be deflected or traded off, the pawn goes through.',
    defend: 'Blockade passed pawns early — put a piece in front of them. Count how many moves the pawn needs, and how many you need to catch it.',
  },
  trappedPiece: {
    missed: ['Trapping pieces', 'A piece of theirs had nowhere to go.'],
    allowed: ['Keeping pieces safe', 'Your piece wandered somewhere it could be trapped.'],
    attack: 'Pieces deep in your half, or bishops boxed in by pawns, are often short of squares. Count their escape squares, then attack.',
    defend: 'Before sending a piece deep, count how it gets back. A piece with one escape square can be trapped by a single pawn move.',
  },
};

export const WEAKNESSES = {};
for (const [theme, t] of Object.entries(TEXT)) {
  for (const side of ['missed', 'allowed']) {
    WEAKNESSES[`${theme}:${side}`] = {
      id: `${theme}:${side}`, theme, side,
      name: t[side][0], blurb: t[side][1],
      habit: side === 'missed' ? t.attack : t.defend,
      kind: side === 'missed' ? 'solve' : 'threat', // puzzle kind that trains it
    };
  }
}
export const weakness = (id) => WEAKNESSES[id] || null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export function currState(p) {
  const c = (p.curr = p.curr || {});
  c.games = c.games || {};
  c.mastered = c.mastered || {};
  c.faded = c.faded || {};
  c.log = c.log || [];
  if (c.active === undefined) c.active = null;
  return c;
}

function log(c, w, what) {
  c.log.push({ at: Date.now(), w, what });
  if (c.log.length > 60) c.log = c.log.slice(-60);
}

// ---------------------------------------------------------------------------
// Evidence from one analysed game
// ---------------------------------------------------------------------------
// evals are the stored per-position evals: {score (White POV), best, pv}.
export function gameEvents({ moves, fens, evals, hero }) {
  const grades = gradeAll(moves, evals);
  const opp = hero === 'w' ? 'b' : 'w';
  const ev = [];
  let n = 0;
  grades.forEach((g, i) => {
    if (!g || g.mover !== hero) return;
    n++;
    const ply = i + 1;
    const eb = evals[ply - 1], ea = evals[ply];
    const heroBefore = scoreFor(eb.score, hero);
    // A missed short mate counts even when the position stays winning.
    const heroMate = heroBefore && heroBefore.mate > 0 && heroBefore.mate <= 3 && !(scoreFor(ea.score, hero)?.mate > 0) ? heroBefore.mate : null;
    const bad = g.grade === 'mistake' || g.grade === 'blunder';
    if (!bad && !heroMate) return;
    const s = g.grade === 'blunder' ? 1.5 : 1;
    const played = moves[ply - 1].san;
    // What did this move allow?
    const oppS = scoreFor(ea.score, opp);
    const oppMate = oppS && oppS.mate > 0 && oppS.mate <= 4 && !(heroBefore && heroBefore.mate < 0) ? oppS.mate : null;
    const a = bad ? classifyTactic(fens[ply], ea.pv, opp, oppMate) : null;
    if (a) ev.push({ w: `${a.motif}:allowed`, ply, s, k: ea.pv[0], ks: a.san, ps: played, d: a.detail });
    // What did it miss?
    if (eb.pv && eb.pv.length && eb.pv[0] !== moveToUci(moves[ply - 1])) {
      const gainBest = materialSwing(fens[ply - 1], eb.pv, hero).delta;
      const gainPlayed = materialSwing(fens[ply - 1], [moveToUci(moves[ply - 1]), ...(ea.pv || [])], hero).delta;
      if (heroMate || gainBest - gainPlayed >= 2) {
        const b = classifyTactic(fens[ply - 1], eb.pv, hero, heroMate);
        if (b) ev.push({ w: `${b.motif}:missed`, ply, s, k: eb.pv[0], ks: b.san, ps: played, d: b.detail });
      }
    }
  });
  return { n, ev: ev.filter((e) => WEAKNESSES[e.w]) };
}

// When was the game played? Imported games carry their own date.
export function playedAt(game) {
  const d = String(game.date || '').replace(/\./g, '-');
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(d + 'T12:00:00') : NaN;
  if (!isFinite(t)) return game.createdAt || Date.now();
  const sameDay = game.createdAt && Math.abs(game.createdAt - t) < DAY;
  return sameDay ? game.createdAt : t;
}

// Record a game's evidence. Returns any progress messages (e.g. verified).
export function noteGame(p, game, line, evals) {
  const c = currState(p);
  if (!game || game.source === 'puzzle' || !game.hero) return [];
  if (!evals || evals.length < line.fens.length || evals.some((e) => !e)) return [];
  const { n, ev } = gameEvents({ moves: line.moves, fens: line.fens, evals, hero: game.hero });
  if (!n) return [];
  c.games[game.id] = { t: playedAt(game), src: game.source || 'game', n, ev };
  delete (c.pending || {})[game.id];
  const ids = Object.keys(c.games).sort((a, b) => c.games[b].t - c.games[a].t);
  for (const id of ids.slice(80)) delete c.games[id];
  return advance(p);
}

function recentGames(c, since = 0) {
  return Object.entries(c.games).filter(([, g]) => g.t >= since).sort((a, b) => b[1].t - a[1].t).map(([id, g]) => ({ id, ...g }));
}

function countIn(games, w) {
  let k = 0;
  for (const g of games) for (const e of g.ev) if (e.w === w) k++;
  return k;
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------
// puzzleLog: [{theme, kind, ok, at}] newest first (from the archive).
export function diagnose(p, puzzleLog = []) {
  const c = currState(p);
  const games = recentGames(c).slice(0, WINDOW);
  const out = [];
  for (const w of Object.values(WEAKNESSES)) {
    let count = 0, weight = 0;
    const examples = [];
    for (const g of games) for (const e of g.ev) if (e.w === w.id) {
      count++;
      weight += e.s;
      if (examples.length < 6) examples.push({ game: g.id, ...e });
    }
    const pz = puzzleLog.filter((x) => x.theme === w.theme && x.kind === w.kind).slice(0, 12);
    const pzOk = pz.filter((x) => x.ok).length;
    const pzRate = pz.length ? pzOk / pz.length : null;
    const gameScore = games.length ? weight / games.length : 0;
    const puzzleScore = pz.length >= 4 ? Math.max(0, 0.7 - pzRate) : 0;
    let score = gameScore + 0.6 * puzzleScore;
    if (c.faded[w.id]) score *= 1.5;
    out.push({
      w, count, games: games.length, rate: games.length ? count / games.length : 0,
      puzzles: pz.length, puzzlesOk: pzOk, score, examples,
      mastered: !!c.mastered[w.id], faded: !!c.faded[w.id],
    });
  }
  return out.filter((x) => x.score > 0.05).sort((a, b) => b.score - a.score);
}

export function topCandidate(ranked, c) {
  return ranked.find((x) => !x.mastered && (!c.active || c.active.w !== x.w.id)) || null;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------
export function startWeakness(p, wid, ranked) {
  const c = currState(p);
  const r = ranked.find((x) => x.w.id === wid);
  c.active = {
    w: wid, stage: 'learn', at: Date.now(),
    baseline: r ? r.rate : 0, baselineGames: r ? r.games : 0,
    sets: 0, recent: [], drilledAt: null, verifyFrom: null, checkup: null, rounds: 1,
  };
  delete c.faded[wid];
  log(c, wid, 'started');
}

export function finishLearning(p) {
  const c = currState(p);
  if (c.active && c.active.stage === 'learn') { c.active.stage = 'drill'; log(c, c.active.w, 'drilling'); }
}

// Has the drill done its job? 2+ sets and 75%+ over the last 8+ attempts.
export function drillProgress(a) {
  const r = a.recent || [];
  const pct = r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0;
  return { sets: a.sets, attempts: r.length, pct: Math.round(pct * 100), ready: a.sets >= 2 && r.length >= 8 && pct >= 0.75 };
}

export function verifyStatus(p) {
  const c = currState(p);
  const a = c.active;
  if (!a || a.stage !== 'verify') return null;
  const games = recentGames(c, a.verifyFrom);
  const count = countIn(games, a.w);
  const allowed = Math.max(0, Math.min(0.34, a.baseline * 0.5));
  const checkupDue = a.drilledAt + CHECKUP_GAP * DAY;
  return {
    games: games.length, count, need: VERIFY_GAMES,
    gamesOk: games.length >= VERIFY_GAMES && count / games.length <= allowed + 1e-9,
    gamesBad: (count >= 2 && games.length && count / games.length >= Math.max(0.3, a.baseline * 0.75)) || games.length >= 6 && count / games.length > allowed,
    checkup: a.checkup, // null | 'passed' | 'failed'
    checkupReady: Date.now() >= checkupDue,
    checkupDue,
  };
}

// Move the active weakness along when the games say so, and spot mastered
// weaknesses that have come back. Returns messages for the UI.
export function advance(p) {
  const c = currState(p);
  const msgs = [];
  const a = c.active;
  if (a && a.stage === 'verify') {
    const v = verifyStatus(p);
    if (v.gamesBad) {
      a.stage = 'drill'; a.sets = 0; a.recent = []; a.rounds = (a.rounds || 1) + 1; a.checkup = null;
      log(c, a.w, 'back-to-drill');
      msgs.push({ w: a.w, kind: 'back', text: `${WEAKNESSES[a.w].name}: it's still turning up in your games (${v.count} in ${v.games}), so it's back to drilling for a bit.` });
    } else if (v.gamesOk && v.checkup === 'passed') {
      c.mastered[a.w] = { at: Date.now(), step: 0, due: Date.now() + RETEST_STEPS[0] * DAY, baseline: a.baseline, rounds: a.rounds || 1 };
      log(c, a.w, 'mastered');
      msgs.push({ w: a.w, kind: 'mastered', text: `${WEAKNESSES[a.w].name}: fixed! Your last ${v.games} games show it's stuck. It'll get a quick re-test in a week.` });
      c.active = null;
    }
  }
  // Mastered ones that are showing up in games again.
  for (const [w, m] of Object.entries(c.mastered)) {
    const games = recentGames(c, m.at);
    if (games.length < 4) continue;
    const k = countIn(games, w);
    if (k >= 2 && k / games.length >= Math.max(0.4, (m.baseline || 0) * 0.75)) {
      delete c.mastered[w];
      c.faded[w] = Date.now();
      log(c, w, 'faded');
      msgs.push({ w, kind: 'faded', text: `${WEAKNESSES[w].name} is creeping back into your games (${k} in ${games.length}), so it's back on your list.` });
    }
  }
  return msgs;
}

export function retestsDue(p) {
  const c = currState(p);
  const now = Date.now();
  return Object.entries(c.mastered).filter(([, m]) => m.due <= now).map(([w, m]) => ({ w, ...m })).sort((a, b) => a.due - b.due);
}

// After a curriculum puzzle set. mode: 'focus' (drill), 'checkup' or 'retest'.
export function afterSet(p, mode, wid, results) {
  const c = currState(p);
  const W = WEAKNESSES[wid];
  const done = results.filter(Boolean);
  const ok = done.filter((r) => r.firstTry).length;
  const msgs = [];
  if (mode === 'focus' && c.active && c.active.w === wid) {
    const a = c.active;
    if (a.stage === 'learn') a.stage = 'drill';
    a.sets++;
    a.recent = [...(a.recent || []), ...done.map((r) => (r.firstTry ? 1 : 0))].slice(-12);
    const d = drillProgress(a);
    if (a.stage === 'drill' && d.ready) {
      a.stage = 'verify'; a.drilledAt = Date.now(); a.verifyFrom = Date.now(); a.checkup = null;
      log(c, wid, 'verifying');
      msgs.push({ kind: 'verify', text: `You're getting these right (${d.pct}% lately). Now the real test: play ${VERIFY_GAMES} games to show it's stuck, and in ${CHECKUP_GAP} days a short check-up set.` });
    } else if (a.stage === 'drill') {
      msgs.push({ kind: 'drill', text: d.attempts < 8 || d.sets < 2 ? `Set ${a.sets} done. Keep going — a couple of sets at 75% or better moves you on to the real-game check.` : `${d.pct}% over your last ${d.attempts}. Aim for 75% to move on.` });
    }
  } else if (mode === 'checkup' && c.active && c.active.w === wid) {
    const pass = ok >= done.length - 1 && done.length >= 3;
    c.active.checkup = pass ? 'passed' : 'failed';
    if (!pass) {
      c.active.stage = 'drill'; c.active.sets = 0; c.active.recent = []; c.active.rounds = (c.active.rounds || 1) + 1; c.active.checkup = null;
      log(c, wid, 'back-to-drill');
      msgs.push({ kind: 'back', text: `${ok}/${done.length} — a few days later it hadn't quite stuck. Back to drilling; it'll come quicker this time.` });
    } else {
      msgs.push({ kind: 'checkup', text: `${ok}/${done.length} — it stuck. ${verifyStatus(p).gamesOk ? '' : 'Now it just needs to hold up in your games.'}` });
      msgs.push(...advance(p).map((m) => ({ kind: m.kind, text: m.text })));
    }
  } else if (mode === 'retest' && c.mastered[wid]) {
    const m = c.mastered[wid];
    const pass = ok >= done.length - 1 && done.length >= 3;
    if (pass) {
      m.step = Math.min(m.step + 1, RETEST_STEPS.length - 1);
      m.due = Date.now() + RETEST_STEPS[m.step] * DAY;
      m.lastRetest = Date.now();
      msgs.push({ kind: 'retest', text: `${ok}/${done.length} — still solid. Next re-test in ${RETEST_STEPS[m.step]} days.` });
    } else {
      delete c.mastered[wid];
      c.faded[wid] = Date.now();
      log(c, wid, 'faded');
      msgs.push({ kind: 'faded', text: `${ok}/${done.length} — ${W.name.toLowerCase()} has faded a little, so it's back on your list.` });
    }
  }
  return msgs;
}

// What the curriculum wants in Today's practice (themes, most urgent first).
export function dailyThemes(p) {
  const c = currState(p);
  const out = [];
  if (c.active && c.active.stage !== 'learn') out.push(WEAKNESSES[c.active.w].theme);
  for (const r of retestsDue(p)) out.push(WEAKNESSES[r.w].theme);
  return [...new Set(out)].filter((t) => THEME[t]);
}

// Puzzle attempts from archive summaries, newest first.
export function puzzleLogFrom(summaries) {
  return summaries.filter((s) => s.source === 'puzzle' && s.puzzle)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => ({ theme: s.puzzle.theme, kind: s.puzzle.kind, ok: !!s.puzzle.firstTry, at: s.createdAt }));
}

export { Chess };
