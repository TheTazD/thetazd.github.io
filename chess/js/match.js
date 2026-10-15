// Pillar 3 logic: match rating (driven by quality of play, not just results),
// per-game breakdown by phase, and the periodic assessment.
import { Chess, winPct, scoreFor, loosePieces, VALUE } from './chessutil.js';
import { summarise, isFlagged } from './analysis.js';

export const ASSESS_EVERY = 8; // matches between assessments
export const ASSESS_DAYS = 14;

export function matchState(p) {
  p.match = p.match || { rating: null, games: [], assessments: [], focus: [] };
  p.match.games = p.match.games || [];
  p.match.assessments = p.match.assessments || [];
  p.match.focus = p.match.focus || [];
  return p.match;
}

export function assessmentDue(p) {
  const m = matchState(p);
  const last = m.assessments[m.assessments.length - 1];
  if (!last) return 'first';
  const since = m.games.filter((g) => g.at > last.at).length;
  if (since >= ASSESS_EVERY) return 'games';
  if (Date.now() - last.at > ASSESS_DAYS * 86400000 && since >= 2) return 'time';
  return null;
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------
// Score for one game, 0..1. Half comes from the result, half from how well the
// player played compared with the bot in the same game. So a sloppy win moves
// the rating up only a little, and a well-played loss costs only a little.
export function performance({ result, heroAcc, botAcc }) {
  const r = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  const q = Math.max(0, Math.min(1, 0.5 + (heroAcc - botAcc) / 30));
  return { r, q, score: 0.5 * r + 0.5 * q };
}

export function ratingChange({ rating, botLevel, score, played }) {
  const exp = 1 / (1 + Math.pow(10, (botLevel - rating) / 400));
  const k = played < 6 ? 48 : played < 20 ? 32 : 24;
  return Math.round(k * (score - exp));
}

// The bot is pitched at the player's rating. A little variety (±40) keeps
// games from feeling identical; after two losses in a row it eases off a touch,
// after three wins it pushes a touch harder.
export function nextBotLevel(m) {
  const base = m.rating || 1000;
  const recent = m.games.slice(-3).map((g) => g.result);
  let adj = 0;
  if (recent.length >= 2 && recent.slice(-2).every((r) => r === 'loss')) adj -= 60;
  if (recent.length >= 3 && recent.every((r) => r === 'win')) adj += 60;
  return Math.round(base + adj + (Math.random() * 80 - 40));
}

// ---------------------------------------------------------------------------
// Per-game breakdown
// ---------------------------------------------------------------------------
function nonPawnMaterial(fen) {
  const c = new Chess(fen);
  let n = 0;
  for (const row of c.board()) for (const p of row) if (p && p.type !== 'p' && p.type !== 'k') n += VALUE[p.type];
  return n;
}

export function phaseOf(fen, ply) {
  if (nonPawnMaterial(fen) <= 26) return 'endgame'; // e.g. rook + minor each, or less
  if (Math.ceil(ply / 2) <= 12) return 'opening';
  return 'middlegame';
}

export const AREAS = {
  opening: { name: 'Opening', hint: 'the first dozen moves' },
  middlegame: { name: 'Middlegame', hint: 'plans and tactics once pieces are out' },
  endgame: { name: 'Endgame', hint: 'when most pieces are off the board' },
  pressure: { name: 'Under pressure', hint: "when you're worse, in check, or a piece is attacked" },
};

// grades: from gradeAll; fens: positions; hero: colour.
export function breakdown(grades, fens, hero) {
  const buckets = { opening: [], middlegame: [], endgame: [], pressure: [] };
  grades.forEach((g, i) => {
    if (!g || g.mover !== hero) return;
    const fen = fens[i];
    buckets[phaseOf(fen, i + 1)].push(g);
    const c = new Chess(fen);
    const behind = winPct(g.before) < 35;
    const attacked = loosePieces(c, hero).length > 0;
    if (behind || c.inCheck() || attacked) buckets.pressure.push(g);
  });
  const out = {};
  for (const [k, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    out[k] = {
      n: list.length,
      acc: Math.round(list.reduce((s, g) => s + g.accuracy, 0) / list.length),
      errors: list.filter((g) => g.grade === 'mistake' || g.grade === 'blunder').length,
    };
  }
  return out;
}

export function gameStats(grades, fens, hero) {
  const bot = hero === 'w' ? 'b' : 'w';
  const me = summarise(grades, hero);
  const them = summarise(grades, bot);
  return {
    heroAcc: me.accuracy ?? 0,
    botAcc: them.accuracy ?? 0,
    blunders: me.blunders,
    mistakes: me.mistakes,
    inaccuracies: me.inaccuracies,
    areas: breakdown(grades, fens, hero),
  };
}

// The player's moves worth explaining for the assessment, worst first.
export function worstMoves(grades, hero, n = 5) {
  return grades
    .filter((g) => g && g.mover === hero && isFlagged(g) && g.grade !== 'inaccuracy')
    .sort((a, b) => b.loss - a.loss)
    .slice(0, n);
}

// Map an explanation (from explain.js) to a puzzle theme to practise.
export function themeForMistake(ex) {
  const why = (ex.why || '').toLowerCase();
  if (ex.kind === 'allows-mate') return why.includes('back') ? 'backRankMate' : 'mateIn1';
  if (ex.kind === 'missed-mate') return /in (2|two)\b/.test(why) || /mate in 2/.test(why) ? 'mateIn2' : 'mateIn1';
  if (why.includes('fork')) return 'fork';
  if (why.includes('pin')) return 'pin';
  if (why.includes('skewer')) return 'skewer';
  if (ex.kind === 'loses-material' || ex.kind === 'missed-gain') return 'hangingPiece';
  return null;
}

export const MISTAKE_LABEL = {
  'allows-mate': 'Missed a checkmate threat against you',
  'missed-mate': 'Missed a checkmate you had',
  'loses-material': 'Left material to be taken',
  'missed-gain': 'Missed a chance to win material',
  positional: 'Positional slip (development, king safety, structure)',
  subtle: 'Subtle — a longer-term idea',
};

// Build an assessment from the latest game plus the recent run of games.
export function buildAssessment(m, game, mistakes) {
  const recent = m.games.slice(-10);
  const areas = {};
  for (const k of Object.keys(AREAS)) {
    const vals = recent.map((g) => g.stats?.areas?.[k]).filter(Boolean);
    const n = vals.reduce((s, v) => s + v.n, 0);
    if (!n) continue;
    areas[k] = {
      acc: Math.round(vals.reduce((s, v) => s + v.acc * v.n, 0) / n),
      errors: vals.reduce((s, v) => s + v.errors, 0),
      moves: n,
      games: vals.length,
    };
  }
  const overall = recent.length ? Math.round(recent.reduce((s, g) => s + (g.stats?.heroAcc || 0), 0) / recent.length) : null;
  // Weakest area: lowest accuracy, weighted towards areas with enough moves.
  const ranked = Object.entries(areas).filter(([, a]) => a.moves >= 4).sort((a, b) => a[1].acc - b[1].acc);
  const weakest = ranked[0] ? ranked[0][0] : null;
  const strongest = ranked.length > 1 ? ranked[ranked.length - 1][0] : null;
  const themeCount = {};
  const kindCount = {};
  for (const x of mistakes) {
    if (x.theme) themeCount[x.theme] = (themeCount[x.theme] || 0) + 1;
    kindCount[x.kind] = (kindCount[x.kind] || 0) + 1;
  }
  // Include theme counts from earlier assessments' games too (they carry over).
  const focus = Object.entries(themeCount).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 3);
  return {
    at: Date.now(),
    gameId: game.id,
    rating: m.rating,
    overall,
    areas,
    weakest,
    strongest,
    mistakes,
    kinds: kindCount,
    focus,
    games: recent.length,
  };
}
