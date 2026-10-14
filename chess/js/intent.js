// "I did that on purpose": the player says what they were going for (and,
// optionally, the follow-up they had in mind). The engine then tests that
// idea directly, rather than only comparing against its own top move.
import { engine } from './engine.js';
import {
  Chess, NAME, other, playUci, sanOf, toWhitePov, scoreFor, winPct, pawnsText, materialSwing,
  playLine, nullMoveOk, nullMoveFen, materialFor, developedCount, mobility, uciToObj,
} from './chessutil.js';
import { explainMove } from './explain.js';

export const INTENTS = [
  { id: 'threat', label: 'Threaten something', ask: 'follow' },
  { id: 'material', label: 'Win material', ask: 'follow' },
  { id: 'king', label: 'Attack the king', ask: 'follow' },
  { id: 'sacrifice', label: 'Sacrifice for an attack', ask: 'follow' },
  { id: 'defend', label: 'Stop a threat', ask: 'worry' },
  { id: 'trade', label: 'Trade pieces', ask: null },
  { id: 'develop', label: 'Develop or improve a piece', ask: null },
];

export const SOUND = 5; // win% points: below this the engine thinks the move is fine
const DEPTH = 14;

function legal(fen, uci) {
  const c = new Chess(fen);
  return !!playUci(c, uci);
}

// Score a specific move in a position, from the point of view of the side to move.
async function scoreMove(fen, uci) {
  const r = await engine.analyse(fen, { depth: DEPTH, searchmoves: [uci] });
  const l = r.lines[0];
  if (!l) return null;
  return { score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp }, pv: l.pv };
}

async function bestIn(fen) {
  const r = await engine.analyse(fen, { depth: DEPTH });
  const l = r.lines[0];
  if (!l) return null;
  return { score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp }, pv: l.pv };
}

// Does `followUci` (a move by `mover` played as if the opponent passed) really threaten something?
async function testThreat(fenAfter, followUci, mover, hero) {
  if (!nullMoveOk(fenAfter)) return { testable: false };
  const nf = nullMoveFen(fenAfter);
  let line;
  if (followUci) {
    if (!legal(nf, followUci)) return { testable: true, legal: false };
    line = await scoreMove(nf, followUci);
  } else {
    line = await bestIn(nf);
  }
  if (!line) return { testable: false };
  const baseline = await bestIn(fenAfter); // opponent to move, real position
  const baseMover = baseline ? { ...negate(baseline.score) } : { cp: 0 };
  const gainPct = winPct(line.score) - winPct(baseMover);
  const swing = materialSwing(nf, line.pv, mover).delta;
  const real = line.score.mate > 0 || swing >= 1 || gainPct >= 10;
  return {
    testable: true, legal: true, real, swing, gainPct, mate: line.score.mate > 0 ? line.score.mate : 0,
    uci: line.pv[0], san: sanOf(nf, line.pv[0]), steps: playLine(nf, line.pv, hero, 6), fen: nf,
  };
}

function negate(score) {
  if (score.mate !== undefined) return { mate: -score.mate };
  return { cp: -score.cp };
}

// After the opponent's best reply, does the follow-up still work?
async function stillWorks(look, followUci, mover) {
  if (!look.reply.pv.length) return null;
  const c = new Chess(look.fenAfter);
  playUci(c, look.reply.pv[0]);
  const fx = c.fen();
  if (!legal(fx, followUci)) return { works: false };
  const f = await scoreMove(fx, followUci);
  const b = await bestIn(fx);
  if (!f || !b) return null;
  const swing = materialSwing(fx, f.pv, mover).delta;
  const works = (f.score.mate > 0) || (swing >= 1 && winPct(b.score) - winPct(f.score) < 5);
  return { works, swing };
}

function threatText(t, v) {
  if (t.mate) return t.mate === 1 ? `${t.san} would be checkmate` : `${t.san} would start a forced mate`;
  if (t.swing >= 1) return `${t.san} would win ${pawnsText(t.swing)}`;
  return `${t.san} would leave ${v.you} clearly better`;
}

// Main entry.
export async function checkIntent({ fenBefore, playedUci, hero, ply, history, intent, followUci, worryUci, explanation }) {
  const ex = explanation && explanation.look ? explanation : await explainMove({ fenBefore, playedUci, hero, ply, history });
  const look = ex.look;
  const mover = look.move.color;
  const v = mover === hero ? { you: 'you', You: 'You', your: 'your', opp: 'your opponent', Opp: 'Your opponent', them: 'they' } : { you: 'they', You: 'They', your: 'their', opp: 'you', Opp: 'You', them: 'you' };
  const sound = ex.loss < SOUND;
  const replySan = look.reply.pv.length ? sanOf(look.fenAfter, look.reply.pv[0]) : null;
  const points = [];
  const lines = [];
  let verdict;

  const engineView = sound
    ? `The engine agrees ${look.move.san} is a reasonable move${ex.grade === 'best' ? ' — in fact it\'s its top choice' : ''}.`
    : `The engine's concern: ${ex.why}`;

  if (intent === 'threat' || intent === 'material' || intent === 'king' || intent === 'sacrifice') {
    const t = await testThreat(look.fenAfter, followUci, mover, hero);
    if (!t.testable) {
      points.push(`${v.Opp} is in check after this move, so there's no "if they ignore it" test — they have to respond.`);
      verdict = sound ? 'holds' : 'doesnt';
    } else if (t.legal === false) {
      points.push(`The follow-up you showed isn't a legal move in that position, so I tested what the move actually threatens instead.`);
      return checkIntent({ fenBefore, playedUci, hero, ply, history, intent, followUci: null, explanation: ex });
    } else {
      if (t.real) {
        points.push(followUci
          ? `Your idea is real: if ${v.opp} ignored it, ${threatText(t, v)}.`
          : `Your move does create a threat: if ${v.opp} ignored it, ${threatText(t, v)}.`);
        lines.push({ title: 'Your idea, if they ignore it', fen: t.fen, steps: t.steps });
        const sw = await stillWorks(look, t.uci, mover);
        if (sw && sw.works) points.push(`Even after ${v.opp}'s best reply (${replySan}), the idea still works.`);
        else if (replySan) points.push(`But ${v.opp} has a good answer: ${replySan}${sound ? ', which deals with it.' : '.'}`);
      } else {
        points.push(followUci
          ? `The follow-up you had in mind, ${t.san}, ${t.swing < 0 ? `actually loses ${pawnsText(t.swing)}` : "doesn't actually win anything"}: ${t.steps.slice(1, 3).map((s) => s.text).join(' ') || 'it runs out of steam.'}`
          : `Your move doesn't create a direct threat — even if ${v.opp} passed, there'd be nothing big to win.`);
        if (t.steps.length) lines.push({ title: followUci ? 'Testing your follow-up' : 'Best try if they pass', fen: t.fen, steps: t.steps });
      }
      if (intent === 'sacrifice') {
        const swing = materialSwing(look.fenBefore, [playedUci, ...look.reply.pv], mover).delta;
        if (swing < 0) {
          points.push(sound
            ? `The sacrifice holds up: ${v.you} give up ${pawnsText(swing)}, but the engine still rates the position as fine for ${v.you}.`
            : `The sacrifice doesn't pay off: ${v.you} end up ${pawnsText(swing)} down without enough attack to make up for it.`);
        } else {
          points.push(`It isn't really a sacrifice — ${v.opp} can't win material by taking.`);
        }
      }
      if (intent === 'king' && t.real && (t.mate || t.steps[0]?.san.includes('+'))) {
        points.push(`The pressure on the king is genuine.`);
      }
      verdict = t.real && sound ? 'holds' : t.real || sound ? 'partly' : 'doesnt';
    }
  } else if (intent === 'defend') {
    const before = look.fenBefore;
    if (!nullMoveOk(before)) {
      points.push(`${v.You} were in check, so this move had to deal with that anyway.`);
      verdict = sound ? 'holds' : 'partly';
    } else {
      const nb = nullMoveFen(before);
      const opp = other(mover);
      let w;
      if (worryUci && legal(nb, worryUci)) w = await scoreMove(nb, worryUci);
      else w = await bestIn(nb);
      const wUci = w ? w.pv[0] : null;
      const wSan = wUci ? sanOf(nb, wUci) : null;
      const wSwing = w ? materialSwing(nb, w.pv, opp).delta : 0;
      const real = w && (w.score.mate > 0 || wSwing >= 1);
      if (!real) {
        points.push(worryUci
          ? `${wSan} wasn't actually a threat: if ${v.opp} had played it, ${v.you} would have been fine.`
          : `There wasn't a serious threat to stop here — ${v.opp} had nothing big if ${v.you} had passed.`);
        if (w) lines.push({ title: `If ${v.opp} played ${wSan}`, fen: nb, steps: playLine(nb, w.pv, hero, 6) });
        verdict = sound ? 'partly' : 'doesnt';
      } else {
        points.push(`The threat was real: ${wSan} would have ${w.score.mate > 0 ? 'led to checkmate' : `won ${pawnsText(wSwing)}`}.`);
        lines.push({ title: 'The threat you saw', fen: nb, steps: playLine(nb, w.pv, hero, 6) });
        let stopped = true;
        if (legal(look.fenAfter, wUci)) {
          const again = await scoreMove(look.fenAfter, wUci);
          const sw = again ? materialSwing(look.fenAfter, again.pv, opp).delta : 0;
          stopped = !(again && (again.score.mate > 0 || sw >= 1));
        }
        points.push(stopped ? `${look.move.san} does stop it.` : `But ${look.move.san} doesn't stop it — ${wSan} still works.`);
        verdict = stopped && sound ? 'holds' : stopped ? 'partly' : 'doesnt';
        if (stopped && !sound) points.push(`There was a better way to deal with it: ${ex.bestSan}.`);
      }
    }
  } else if (intent === 'trade') {
    const c = new Chess(look.fenBefore);
    const ahead = materialFor(c, mover);
    const swing = materialSwing(look.fenBefore, [playedUci, ...look.reply.pv], mover).delta;
    if (swing < 0) points.push(`The trade isn't even: ${v.you} lose ${pawnsText(swing)} in the exchange.`);
    else points.push(`The material stays level through the exchange.`);
    if (ahead >= 2) points.push(`Trading pieces when ${v.you}'re ahead is good technique — fewer pieces makes the extra material count for more.`);
    else if (ahead <= -2) points.push(`Be careful trading when behind: it usually makes the deficit harder to overcome.`);
    verdict = sound && swing >= 0 ? 'holds' : sound || swing >= 0 ? 'partly' : 'doesnt';
  } else if (intent === 'develop') {
    const b = new Chess(look.fenBefore), a = new Chess(look.fenAfter);
    const db = developedCount(b, mover), da = developedCount(a, mover);
    const pieceMovesBefore = new Chess(look.fenBefore).moves({ square: look.move.from }).length;
    const ca = new Chess(look.fenAfter.split(' ')[1] === mover ? look.fenAfter : nullMoveFen(look.fenAfter));
    const pieceMovesAfter = nullMoveOk(look.fenAfter) || look.fenAfter.split(' ')[1] === mover ? ca.moves({ square: look.move.to }).length : 0;
    if (da > db) points.push(`It does bring a new piece into the game.`);
    else if (pieceMovesAfter > pieceMovesBefore) points.push(`The ${NAME[look.move.piece]} is more active on ${look.move.to} (${pieceMovesAfter} squares to go to, up from ${pieceMovesBefore}).`);
    else points.push(`The ${NAME[look.move.piece]} isn't more active on ${look.move.to} than it was on ${look.move.from}.`);
    verdict = sound ? 'holds' : 'partly';
  }

  points.push(engineView);
  if (!sound && ex.bestSan) points.push(`The engine's choice was ${ex.bestSan}.`);

  const titles = {
    holds: 'Your reasoning holds',
    partly: 'Right idea, but not the whole story',
    doesnt: "The idea doesn't work here",
  };
  return { verdict, title: titles[verdict], points, lines, explanation: ex };
}
