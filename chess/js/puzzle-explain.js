// Plain-English explanation of why a puzzle's solution works: names the
// concrete targets (what's forked, what's pinned or skewered, what's free),
// then the outcome. Falls back to describing the line rather than guessing.
import { Chess, VALUE, NAME, other, playUci, attackers, targetsOf, materialSwing, pawnsText, describeMove, sanOf } from './chessutil.js';
import { startFen } from './puzzles.js';
import { THEME } from './themes.js';

const DIRS = { r: [[1, 0], [-1, 0], [0, 1], [0, -1]], b: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
DIRS.q = DIRS.r.concat(DIRS.b);

function voice(me) {
  return me
    ? { you: 'you', your: 'your', their: 'their', You: 'You', Your: 'Your', they: 'they' }
    : { you: 'they', your: 'their', their: 'your', You: 'They', Your: 'Their', they: 'you' };
}

function sq(f, r) { return 'abcdefgh'[f] + (r + 1); }

function rayPair(chess, from, dir) {
  let f = from.charCodeAt(0) - 97, r = +from[1] - 1;
  const hits = [];
  for (;;) {
    f += dir[0]; r += dir[1];
    if (f < 0 || f > 7 || r < 0 || r > 7) break;
    const s = sq(f, r);
    const p = chess.get(s);
    if (p) { hits.push({ square: s, piece: p }); if (hits.length === 2) break; }
  }
  return hits;
}

function nameOf(t, v) {
  return t.piece.type === 'k' ? `${v.their} king` : `${v.their} ${NAME[t.piece.type]} on ${t.square}`;
}

function list(names) {
  return names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// Steps of the solution from the position the solver faces.
export function solutionSteps(pz, hero) {
  const c = new Chess(startFen(pz));
  const out = [];
  for (const uci of pz.sol) {
    const before = c.fen();
    const m = playUci(c, uci);
    if (!m) break;
    out.push({ uci, san: m.san, move: m, fenBefore: before, fen: c.fen(), text: describeMove(m, hero) });
  }
  return out;
}

// What does the piece that just moved (or the line it opened) attack?
function tacticSentence(step, v, themeId) {
  const after = new Chess(step.fen);
  const m = step.move;
  const me = m.color;
  // Line tactics: pin or skewer along the moved piece's lines.
  if ('rbq'.includes(m.piece) && (themeId === 'pin' || themeId === 'skewer' || !themeId)) {
    for (const d of DIRS[m.piece]) {
      const [front, back] = rayPair(after, m.to, d);
      if (!front || !back || front.piece.color === me || back.piece.color === me) continue;
      const fv = front.piece.type === 'k' ? 100 : VALUE[front.piece.type];
      const bv = back.piece.type === 'k' ? 100 : VALUE[back.piece.type];
      const backLoose = !attackers(after, back.square, back.piece.color).length;
      if (fv > bv && (front.piece.type === 'k' || fv > VALUE[m.piece]) && (back.piece.type !== 'p' || backLoose)) {
        return `${step.san} is a skewer: it attacks ${nameOf(front, v)}, and when that moves, ${nameOf(back, v)} behind it on the same line can be taken.`;
      }
      if (bv > fv && fv < 100) {
        const absolute = back.piece.type === 'k';
        return `${step.san} pins ${nameOf(front, v)}: ${absolute ? "it can't legally move, because" : "if it moves,"} ${nameOf(back, v)} behind it ${absolute ? 'would be in check' : 'would be exposed'}.`;
      }
    }
  }
  // Double attacks: the moved piece, or a piece it uncovered.
  const valuable = (from) => {
    const p = after.get(from);
    return targetsOf(after, from).filter(({ square, piece }) => piece.type === 'k' || VALUE[piece.type] > VALUE[p.type] || !attackers(after, square, piece.color).length);
  };
  // Leave pawns out of the list when bigger targets are involved.
  const trim = (l) => (l.filter((t) => t.piece.type !== 'p').length >= 2 ? l.filter((t) => t.piece.type !== 'p') : l);
  const own = trim(valuable(m.to));
  if (own.length >= 2) {
    return `After ${step.san}, ${v.your} ${NAME[m.piece]} attacks ${list(own.map((t) => nameOf(t, v)))} at the same time, and only one can be saved.`;
  }
  const before = new Chess(step.fenBefore);
  for (const s of 'abcdefgh'.split('').flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => f + r))) {
    const p = after.get(s);
    if (!p || p.color !== me || s === m.to) continue;
    const now = valuable(s).filter((t) => !attackers(before, t.square, me).includes(s));
    if (now.length) {
      const extra = own.length ? ` while the ${NAME[m.piece]} itself attacks ${nameOf(own[0], v)}` : '';
      return `Moving the ${NAME[m.piece]} uncovers ${v.your} ${NAME[p.type]} on ${s}, which now attacks ${list(now.map((t) => nameOf(t, v)))}${extra} — a discovered attack.`;
    }
  }
  return null;
}

export function explainSolution(pz, hero, { me = true } = {}) {
  const v = voice(me);
  const steps = solutionSteps(pz, hero);
  if (!steps.length) return { why: 'The puzzle data for this one looks broken — skip it.', more: [], line: { title: 'Solution', fen: startFen(pz), steps: [] }, keySan: '' };
  const mover = steps[0]?.move.color;
  const theme = THEME[pz.theme];
  const key = steps[0];
  const lastStep = steps[steps.length - 1];
  const mates = lastStep && lastStep.san.includes('#');
  const mine = steps.filter((s) => s.move.color === mover);
  let why = '';

  if (mates && steps.length === 1) {
    why = `${key.san} is checkmate: the king is in check, it has no safe square to step to, and the check can't be blocked or the piece captured.`;
  } else if (mates) {
    const replies = steps.filter((s) => s.move.color !== mover).map((s) => s.san);
    why = `${key.san}${key.san.includes('+') ? ' is check and' : ''} leaves ${me ? 'your opponent' : 'you'} ${replies.length === 1 ? `only ${replies[0]}` : 'no good defence'}, and then ${lastStep.san} is checkmate.`;
  } else if (pz.theme === 'hangingPiece' && key.move.captured && !attackers(new Chess(key.fenBefore), key.move.to, other(mover)).length) {
    const piece = `${NAME[key.move.captured]} on ${key.move.to}`;
    why = me
      ? `Your opponent left their ${piece} with no protection, so ${key.san} wins it for free.`
      : `Your ${piece} has no protection, so they can take it for free with ${key.san}.`;
  } else {
    for (const s of mine) {
      why = tacticSentence(s, v, pz.theme) || '';
      if (why) {
        if (s !== key) why = `It starts with ${key.san}. ${why}`;
        break;
      }
    }
    if (!why && key.move.captured && !attackers(new Chess(key.fenBefore), key.move.to, other(mover)).length) {
      const piece = `${NAME[key.move.captured]} on ${key.move.to}`;
      why = me
        ? `Your opponent left their ${piece} with no protection, so ${key.san} wins it for free.`
        : `Your ${piece} has no protection, so they can take it for free with ${key.san}.`;
    }
  }

  // Outcome
  let outcome = '';
  if (mates) outcome = `${me ? 'You deliver' : 'They deliver'} checkmate.`;
  else {
    const promo = mine.find((s) => s.move.promotion);
    const sw = materialSwing(startFen(pz), pz.sol, mover, 12).delta;
    if (promo) outcome = `The pawn promotes on ${promo.move.to}${sw >= 1 ? `, and ${v.you} end up ${pawnsText(sw)} ahead` : ''}.`;
    else if (sw >= 1) outcome = `In the end ${v.you} come out ${pawnsText(sw)} ahead.`;
    else outcome = `It leaves ${v.you} with a winning position.`;
  }
  if (pz.result && !mates) outcome = pz.result;
  if (!why) why = `The key move is ${key.san}. ${outcome}`;
  else if (!mates) why += ` ${outcome}`;

  const more = [];
  more.push(`The whole line: ${steps.map((s) => s.text).join(' ')}`);
  if (pz.concept) more.push(pz.concept);
  else if (theme) more.push(theme.concept);
  return {
    why,
    more,
    line: { title: me ? 'Play through the solution' : 'Play through their threat', fen: startFen(pz), steps },
    keySan: key ? key.san : '',
  };
}

export { sanOf };
