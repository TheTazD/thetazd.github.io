// Turns engine output into plain-English, layered explanations.
// Layer 0: the flag (grade). Layer 1: "why?" — one or two sentences.
// Layer 2: "tell me more" — what happens next, what was better, and why.
import { engine } from './engine.js';
import {
  Chess, VALUE, NAME, other, uciToObj, playUci, sanOf, toWhitePov, scoreFor, winPct,
  describeStanding, pawnsText, materialSwing, playLine, attackers, targetsOf, loosePieces,
  mobility, developedCount, pawnIssues, kingSquare, nullMoveOk, nullMoveFen, moveToUci,
} from './chessutil.js';

export const DEEP_DEPTH = 16;

function voice(me) {
  return me
    ? { you: 'you', You: 'You', your: 'your', Your: 'Your', them: 'they', Them: 'They', their: 'their', Their: 'Their', opp: 'your opponent', Opp: 'Your opponent' }
    : { you: 'they', You: 'They', your: 'their', Your: 'Their', them: 'you', Them: 'You', their: 'your', Their: 'Your', opp: 'you', Opp: 'You' };
}

function terminal(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { mated: true };
  if (c.isGameOver()) return { draw: true };
  return null;
}

// Deeper look at one move: best alternatives before it, best reply after it.
export async function deepLook(fenBefore, playedUci) {
  const c = new Chess(fenBefore);
  const m = playUci(c, playedUci);
  const fenAfter = c.fen();
  const b = await engine.analyse(fenBefore, { depth: DEEP_DEPTH, multipv: 3 });
  const best = b.lines.map((l) => ({ score: toWhitePov(l, fenBefore), pv: l.pv }));
  let reply;
  const t = terminal(fenAfter);
  if (t && t.mated) reply = { score: { cp: m.color === 'w' ? 100000 : -100000 }, pv: [] };
  else if (t && t.draw) reply = { score: { cp: 0 }, pv: [] };
  else {
    const a = await engine.analyse(fenAfter, { depth: DEEP_DEPTH });
    const l = a.lines[0];
    reply = { score: toWhitePov(l, fenAfter), pv: l.pv };
  }
  // If the played move is one of the top lines, use that line's score for consistency.
  const same = best.find((x) => x.pv[0] === playedUci);
  return { fenBefore, fenAfter, move: m, best, reply, playedLine: same || null };
}

function pieceAt(chess, sq) {
  return chess.get(sq) || null;
}

function forkTargets(chess, from) {
  const p = pieceAt(chess, from);
  if (!p) return [];
  return targetsOf(chess, from).filter(({ square, piece }) => {
    if (piece.type === 'k') return true;
    const defended = attackers(chess, square, piece.color).length > 0;
    return !defended || VALUE[piece.type] > VALUE[p.type];
  });
}

function listNames(arr) {
  const names = arr.map((t) => (t.piece.type === 'k' ? 'king' : `${NAME[t.piece.type]} on ${t.square}`));
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// Why does the reply win material? Returns a sentence or null.
function explainLoss(look, v) {
  const { fenBefore, fenAfter, move, reply } = look;
  if (!reply.pv.length) return null;
  const after = new Chess(fenAfter);
  const before = new Chess(fenBefore);
  const r = playUci(new Chess(fenAfter), reply.pv[0]);
  if (!r) return null;
  const rSan = r.san;
  if (r.captured) {
    const sq = r.to;
    const victim = NAME[r.captured];
    const defenders = attackers(after, sq, move.color);
    if (sq === move.to) {
      if (!defenders.length) return `${v.Your} ${victim} on ${sq} has no protection there, so ${v.them} can simply take it with ${rSan}.`;
      if (VALUE[r.piece] < VALUE[r.captured]) return `${v.Your} ${victim} on ${sq} can be taken by a ${NAME[r.piece]} (${rSan}). It's defended, but swapping a ${NAME[r.captured]} for a ${NAME[r.piece]} loses material.`;
      return `${v.Them} win material starting with ${rSan}: ${v.your} ${victim} on ${sq} is attacked more times than it's defended.`;
    }
    const guardedBefore = attackers(before, sq, move.color).includes(move.from);
    if (guardedBefore && !attackers(after, sq, move.color).length) {
      return `Moving ${v.your} ${NAME[move.piece]} away from ${move.from} stopped it guarding ${v.your} ${victim} on ${sq}, so ${v.them} can take it with ${rSan}.`;
    }
    const wasLoose = loosePieces(before, move.color).some((x) => x.square === sq);
    if (wasLoose) return `${v.Your} ${victim} on ${sq} was already under attack, and this move doesn't deal with it — ${v.them} take it with ${rSan}.`;
    if (move.captured) return `${v.You} won a ${NAME[move.captured]}, but ${v.them} get more back with ${rSan}.`;
    return `After ${rSan}, ${v.them} win ${v.your} ${victim} on ${sq}.`;
  }
  const afterR = new Chess(fenAfter);
  playUci(afterR, reply.pv[0]);
  const forks = forkTargets(afterR, r.to);
  if (forks.length >= 2) {
    return `${v.Them} have ${rSan}, a fork: the ${NAME[r.piece]} attacks ${v.your} ${listNames(forks)} at the same time, and ${v.you} can only save one.`;
  }
  if (r.san.includes('+')) return `${v.Them} have ${rSan}, a check that sets up winning material on the next move.`;
  // Several weak points attacked at once (often by more than one piece).
  const loose = loosePieces(new Chess(nullMoveFen(afterR.fen())), move.color);
  if (loose.length >= 2) {
    return `After ${rSan}, ${v.your} ${listNames(loose.slice(0, 3))} are under attack at the same time, and ${v.you} can't defend everything.`;
  }
  if (loose.length === 1) {
    return `${rSan} attacks ${v.your} ${listNames(loose)}, and there's no good way to keep it.`;
  }
  return `${v.Them} have ${rSan}, which creates a threat ${v.you} can't fully meet.`;
}

// Why would the best move have gained material?
function explainGain(look, bestPv, v) {
  const { fenBefore } = look;
  const before = new Chess(fenBefore);
  const b = playUci(new Chess(fenBefore), bestPv[0]);
  if (!b) return null;
  if (b.captured) {
    const sq = b.to;
    const defended = attackers(before, sq, other(b.color)).length > 0;
    if (!defended) return `${v.Their} ${NAME[b.captured]} on ${sq} was undefended — ${v.you} could have taken it for free with ${b.san}.`;
    if (VALUE[b.captured] > VALUE[b.piece]) return `${b.san} wins material: ${v.their} ${NAME[b.captured]} is defended, but it's worth more than the ${NAME[b.piece]} ${v.you} take it with.`;
    return gainLine(fenBefore, bestPv, b, v);
  }
  const afterB = new Chess(fenBefore);
  playUci(afterB, bestPv[0]);
  const forks = forkTargets(afterB, b.to);
  if (forks.length >= 2) return `${b.san} would fork ${v.their} ${listNames(forks)} — the ${NAME[b.piece]} attacks both and they can't save everything.`;
  if (b.san.includes('+')) return `${b.san} comes with check and wins material on the next move.`;
  return gainLine(fenBefore, bestPv, b, v);
}

function gainLine(fen, pv, b, v) {
  const sw = materialSwing(fen, pv, b.color).delta;
  const steps = playLine(fen, pv, b.color, 6).map((s) => s.san).join(' ');
  return sw >= 1
    ? `${b.san} was stronger: after ${steps}, ${v.you} come out ${pawnsText(sw)} ahead.`
    : `${b.san} was stronger: ${steps}.`;
}

function positional(look, bestPv, v, ply) {
  const { fenBefore, fenAfter, move } = look;
  const reasons = [];
  const before = new Chess(fenBefore);
  const after = new Chess(fenAfter);
  const bestAfter = new Chess(fenBefore);
  const b = playUci(bestAfter, bestPv[0]);
  const bSan = b ? b.san : null;
  const me = move.color;
  const fullmove = Math.ceil(ply / 2);

  const rights = (fen, c) => {
    const r = fen.split(' ')[2];
    return c === 'w' ? /[KQ]/.test(r) : /[kq]/.test(r);
  };
  if (rights(fenBefore, me) && !rights(fenAfter, me) && !move.san.startsWith('O-O') && b && rights(bestAfter.fen(), me)) {
    reasons.push(`Moving ${v.your} ${NAME[move.piece]} gives up the right to castle, so ${v.your} king may get stuck in the middle of the board.`);
  }
  if (b && b.san.startsWith('O-O') && !move.san.startsWith('O-O')) {
    reasons.push(`Castling (${b.san}) was the priority here: it tucks ${v.your} king away and brings a rook into the game.`);
  }
  if (fullmove <= 12) {
    const dev = developedCount(before, me);
    if (move.piece === 'q' && dev < 3) reasons.push(`Bringing the queen out this early lets ${v.opp} develop with tempo by attacking it.`);
    const movedBefore = look.history && look.history.some((h) => h.color === me && h.to === move.from);
    if (movedBefore && move.piece !== 'q' && dev < 3 && !move.captured) reasons.push(`This moves the same piece again while others are still at home — in the opening, getting new pieces out usually matters more.`);
    const attacksSomething = move.piece === 'p' && targetsOf(after, move.to).length > 0;
    if (fullmove <= 8 && !attacksSomething && move.piece === 'p' && 'ah'.includes(move.from[0]) && dev < 3 && b && b.piece !== 'p') reasons.push(`A pawn move on the edge doesn't help ${v.your} development; ${bSan} gets a piece into play.`);
  }
  const ks = kingSquare(after, me);
  if (move.piece === 'p' && ks && Math.abs(ks.charCodeAt(0) - move.from.charCodeAt(0)) <= 1 && 'abcfgh'.includes(ks[0]) && (ks[1] === '1' || ks[1] === '8')) {
    reasons.push(`This pawn move loosens the shield in front of ${v.your} king, creating weak squares ${v.opp} may use later.`);
  }
  const recaptured = move.captured && look.reply.pv[0] && look.reply.pv[0].slice(2, 4) === move.to;
  if (recaptured) {
    const rr = playUci(new Chess(fenAfter), look.reply.pv[0]);
    const bishopForKnight = move.piece === 'b' && move.captured === 'n';
    reasons.push(`This swap lets ${v.opp} recapture with ${v.their} ${NAME[rr.piece]}, bringing it into a good spot on ${move.to}${bishopForKnight ? ` — and ${v.you} give up a bishop for a knight` : ''}.`);
  }
  const looseMine = loosePieces(new Chess(nullMoveFen(fenAfter)), me).filter((l) => !(recaptured && l.square === move.to));
  const looseBest = b ? loosePieces(new Chess(nullMoveFen(bestAfter.fen())), me) : [];
  if (looseMine.length > looseBest.length) {
    const lp = looseMine[0];
    reasons.push(`It leaves ${v.your} ${NAME[lp.piece.type]} on ${lp.square} loose — attacked and not properly defended — which hands ${v.opp} chances.`);
  }
  const pi = pawnIssues(after, me), pb = b ? pawnIssues(bestAfter, me) : pi;
  if (pi.doubled > pb.doubled) reasons.push(`It leaves ${v.you} with doubled pawns, which are harder to defend and less useful.`);
  else if (pi.isolated > pb.isolated) reasons.push(`It creates an isolated pawn that can become a target.`);
  if (b) {
    const mPlayed = mobility(fenAfter, me), mBest = mobility(bestAfter.fen(), me);
    if (mBest - mPlayed >= 6) reasons.push(`${bSan} gives ${v.your} pieces much more room to move (${mBest} moves available vs ${mPlayed}).`);
  }
  return reasons;
}

function standingPhrase(v, s, verb) {
  if (s === 'about equal') return `the game ${verb} about equal`;
  const plural = verb === 'is' ? 'are' : 'were';
  return `${v.you} ${plural} ${s}`;
}

function lineSentence(steps, n = 4) {
  return steps.slice(0, n).map((s) => s.san).join(' ');
}

// Main entry: explain move `ply` of a game. `hero` is the reviewer's colour.
export async function explainMove({ fenBefore, playedUci, hero, ply, history = [] }) {
  const look = await deepLook(fenBefore, playedUci);
  look.history = history;
  const { move, best, reply, fenAfter } = look;
  const me = move.color === hero;
  const v = voice(me);
  const mover = move.color;
  const beforeS = scoreFor(best[0].score, mover);
  const afterS = scoreFor(reply.score, mover);
  const wb = winPct(beforeS), wa = winPct(afterS);
  const loss = Math.max(0, wb - wa);
  const bestPv = best[0].pv;
  const bestUci = bestPv[0];
  const isBest = bestUci === playedUci;
  const bestSan = sanOf(fenBefore, bestUci);
  const bestAfterScore = scoreFor(best[0].score, mover);

  let grade;
  if (isBest) grade = 'best';
  else if (loss >= 15) grade = 'blunder';
  else if (loss >= 10) grade = 'mistake';
  else if (loss >= 5) grade = 'inaccuracy';
  else grade = 'good';
  if (beforeS.mate > 0 && !(afterS.mate > 0) && grade === 'good') grade = 'inaccuracy';

  const replySteps = playLine(fenAfter, reply.pv, hero, 8);
  const bestSteps = playLine(fenBefore, bestPv, hero, 8);
  const standing = {
    before: describeStanding(wb),
    after: describeStanding(wa),
    best: describeStanding(winPct(bestAfterScore)),
  };

  const out = { look, ply, grade, loss, wb, wa, bestUci, bestSan, playedSan: move.san, me, reasons: [], why: '', more: [], lines: [], arrows: [] };
  out.arrows.push({ from: move.from, to: move.to, kind: 'played' });

  // --- Good moves --------------------------------------------------------
  if (grade === 'best' || grade === 'good') {
    out.why = grade === 'best'
      ? `${move.san} is the engine's top choice here.`
      : `${move.san} is a good move — the engine slightly prefers ${bestSan}, but the difference is small.`;
    const t = await whatItThreatens(fenAfter, hero, mover);
    if (t) out.more.push(t.text), out.lines.push(t.line);
    if (!isBest && bestSteps.length) out.lines.push({ title: `Engine's choice: ${bestSan}`, fen: fenBefore, steps: bestSteps });
    out.more.push(`After this move ${standingPhrase(v, standing.after, 'is')}.`);
    return out;
  }

  // --- Mistakes ----------------------------------------------------------
  const mSwingPlayed = materialSwing(fenBefore, [playedUci, ...reply.pv], mover).delta;
  const mSwingBest = materialSwing(fenBefore, bestPv, mover).delta;

  if (afterS.mate < 0 && !(beforeS.mate < 0)) {
    const n = -afterS.mate;
    out.reasons.push(n === 1
      ? `This allows checkmate: ${v.opp} can play ${replySteps[0]?.san}.`
      : `This lets ${v.opp} force checkmate in ${n} moves, starting with ${replySteps[0]?.san}.`);
    out.kind = 'allows-mate';
  } else if (beforeS.mate > 0 && !(afterS.mate > 0)) {
    const n = beforeS.mate;
    out.reasons.push(n === 1
      ? `${v.You} had checkmate in one: ${bestSan}.`
      : `${v.You} had a forced checkmate in ${n}, starting with ${bestSan}.`);
    out.kind = 'missed-mate';
  } else if (mSwingBest - mSwingPlayed >= 1) {
    if (mSwingPlayed <= -1) {
      const s = explainLoss(look, v);
      out.reasons.push(`${s || `This loses ${pawnsText(mSwingPlayed)}.`}`);
      out.kind = 'loses-material';
      if (mSwingBest >= 1) out.reasons.push(explainGain(look, bestPv, v));
    } else {
      out.reasons.push(explainGain(look, bestPv, v));
      out.kind = 'missed-gain';
    }
  } else {
    const p = positional(look, bestPv, v, ply);
    if (p.length) out.reasons.push(...p.slice(0, 2));
    out.kind = 'positional';
  }
  if (!out.reasons.length || !out.reasons[0]) {
    out.reasons = [`There's no quick tactic here. The engine prefers ${bestSan} because of how the next few moves play out: ${lineSentence(bestSteps)}.`];
    out.kind = 'subtle';
  }
  out.why = out.reasons[0];

  // Layer 2
  const swingText = mSwingPlayed <= -1 && out.kind !== 'allows-mate' ? ` In the end ${v.you} lose ${pawnsText(mSwingPlayed)}.` : '';
  if (replySteps.length && out.kind !== 'missed-mate') {
    out.more.push(`What happens next: ${replySteps.slice(0, 4).map((s) => s.text).join(' ')}${swingText}`);
    out.lines.push({ title: `What ${v.opp} can do`, fen: fenAfter, steps: replySteps });
    out.arrows.push({ from: replySteps[0].move.from, to: replySteps[0].move.to, kind: 'threat' });
  }
  if (out.reasons[1]) out.more.push(out.reasons[1]);
  else if (out.kind !== 'missed-gain' && out.kind !== 'missed-mate') {
    const extra = out.kind === 'positional' || out.kind === 'subtle' ? null : bestReason(look, bestPv, v);
    out.more.push(extra || `Better was ${bestSan}.`);
  }
  out.lines.push({ title: `Better: ${bestSan}`, fen: fenBefore, steps: bestSteps });
  out.arrows.push({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), kind: 'best' });
  out.more.push(`Before this move ${standingPhrase(v, standing.before, 'was')}. After ${move.san}, ${standingPhrase(v, standing.after, 'is')}. After ${bestSan}, it would have been ${standing.best === 'about equal' ? 'about equal' : standing.best + ' for ' + (v.you === 'you' ? 'you' : 'them')}.`);
  if (best[1] && best[1].pv[0] !== playedUci) {
    const alt = scoreFor(best[1].score, mover);
    if (Math.abs(winPct(alt) - winPct(bestAfterScore)) < 5) out.more.push(`${sanOf(fenBefore, best[1].pv[0])} was about as good as ${bestSan}.`);
  }
  return out;
}

function bestReason(look, bestPv, v) {
  const { fenBefore, move } = look;
  const b = playUci(new Chess(fenBefore), bestPv[0]);
  if (!b) return null;
  // Does the best move save a piece that was attacked?
  const loose = loosePieces(new Chess(fenBefore), move.color);
  if (loose.some((l) => l.square === b.from)) return `Better was ${b.san}, moving the attacked ${NAME[b.piece]} to safety.`;
  if (b.captured) return `Better was ${b.san}, taking ${v.their} ${NAME[b.captured]}.`;
  return `Better was ${b.san}.`;
}

// What does a (good) move threaten? Uses a "pass" for the opponent.
async function whatItThreatens(fenAfter, hero, mover) {
  if (!nullMoveOk(fenAfter)) return null;
  const nf = nullMoveFen(fenAfter);
  const r = await engine.analyse(nf, { depth: 12 });
  const l = r.lines[0];
  if (!l) return null;
  const sw = materialSwing(nf, l.pv, mover).delta;
  const steps = playLine(nf, l.pv, hero, 6);
  const v = voice(mover === hero);
  if (l.mate > 0) return { text: `It threatens checkmate: if ignored, ${steps[0].san} follows.`, line: { title: 'The threat', fen: nf, steps } };
  if (sw >= 1) return { text: `It also sets up a threat: if ${v.opp} ignored it, ${steps[0].san} would win ${pawnsText(sw)}.`, line: { title: 'The threat', fen: nf, steps } };
  return null;
}
