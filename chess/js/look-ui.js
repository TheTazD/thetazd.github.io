// "My look" screen: avatar, board colours and piece set for the current player,
// with some choices unlocked by learning milestones. Plus the small home card.
import { Board } from './board.js';
import { loadProgress, saveProgress } from './puzzles.js';
import { avatarHtml, openAvatarPicker } from './avatars.js';
import { MILESTONES, BOARDS, PIECE_SETS, milestone, isUnlocked, newlyUnlocked, applyLook, pieceUrl, boardById, piecesById } from './look.js';

let C; // { app, $, esc, topbar, go, toast, profile() }
export function initLook(ctx) { C = ctx; }
const esc = (s) => C.esc(s);

const CLASSIC = { light: '#ecdcbf', dark: '#a9805a' };
const PREVIEW_FEN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 5';

// Record milestones reached since last time; they're flagged "new" until the
// player opens My look. Returns the ids just unlocked.
function catchUp(p) {
  const fresh = newlyUnlocked(p);
  if (!fresh.length) return fresh;
  const look = (p.look = p.look || {});
  look.unlocked = [...(look.unlocked || []), ...fresh];
  look.fresh = [...new Set([...(look.fresh || []), ...fresh])];
  return fresh;
}

const rewardsFor = (mid) => [
  ...BOARDS.filter((b) => b.unlock === mid).map((b) => `${b.label} board`),
  ...PIECE_SETS.filter((s) => s.unlock === mid).map((s) => `${s.label} pieces`),
];

export async function homeLookCard() {
  const prof = C.profile();
  const p = await loadProgress(prof.id);
  if (catchUp(p).length) {
    try { await saveProgress(p); } catch (e) { console.warn(e); }
    prof.look = p.look;
  }
  const fresh = (p.look && p.look.fresh) || [];
  const sub = fresh.length
    ? `Unlocked: ${fresh.flatMap(rewardsFor).join(', ')}`
    : 'Your avatar, board colours and pieces';
  return `<section><h2 class="section-title">Make it yours</h2><a class="add-btn look-card${fresh.length ? ' has-new' : ''}" href="#/look">
    ${avatarHtml(prof.name, p.look)}
    <span><b>My look ${fresh.length ? '<span class="new-pill">New</span>' : ''}</b><small>${esc(sub)}</small></span>
    <span class="pz-row-go">›</span>
  </a></section>`;
}

export async function renderLook() {
  const prof = C.profile();
  const p = await loadProgress(prof.id);
  catchUp(p);
  const look = (p.look = p.look || {});
  const fresh = look.fresh || [];
  look.fresh = [];
  if (fresh.length) saveProgress(p).catch((e) => console.warn(e));
  prof.look = look;

  const boardTile = (b) => {
    const on = boardById(look.board).id === b.id;
    const open = isUnlocked(look, b);
    const col = b.light ? b : CLASSIC;
    return `<button type="button" class="look-tile${on ? ' on' : ''}${open ? '' : ' locked'}" data-kind="board" data-id="${b.id}" aria-pressed="${on}" aria-label="${esc(b.label)} board${open ? '' : ', locked'}">
      <span class="mini-board" style="--l:${col.light};--d:${col.dark}"></span>
      <span class="look-label">${open ? '' : '🔒 '}${esc(b.label)}</span>
    </button>`;
  };
  const pieceTile = (s) => {
    const on = piecesById(look.pieces).id === s.id;
    const open = isUnlocked(look, s);
    return `<button type="button" class="look-tile${on ? ' on' : ''}${open ? '' : ' locked'}" data-kind="pieces" data-id="${s.id}" aria-pressed="${on}" aria-label="${esc(s.label)} pieces${open ? '' : ', locked'}">
      <span class="mini-pieces"><span class="ms light" style="background-image:url('${pieceUrl(s, 'w', 'n')}')"></span><span class="ms dark" style="background-image:url('${pieceUrl(s, 'b', 'q')}')"></span></span>
      <span class="look-label">${open ? '' : '🔒 '}${esc(s.label)}</span>
    </button>`;
  };
  const goalRow = (m) => {
    const have = Math.min(m.have(p), m.need);
    const done = (look.unlocked || []).includes(m.id);
    return `<li class="goal${done ? ' done' : ''}">
      <div class="goal-top"><b>${done ? '✓ ' : ''}${esc(m.label)}</b><span class="muted small">${done ? 'unlocked' : `${have} / ${m.need}`}</span></div>
      ${done ? '' : `<div class="goal-bar"><span style="width:${Math.round((100 * have) / m.need)}%"></span></div>`}
      <small class="muted">${esc(rewardsFor(m.id).join(' · '))}</small>
    </li>`;
  };

  C.app.innerHTML = `${C.topbar('My look')}
  <main class="page narrow look-page">
    ${fresh.length ? `<div class="card unlock-banner"><b>🎉 New for you</b><p>${fresh.map((id) => `${esc(rewardsFor(id).join(' and '))} — ${esc(milestone(id).label.replace(/^./, (c) => c.toLowerCase()))}: done!`).join('<br>')}</p></div>` : ''}
    <div class="look-head">
      <span id="look-avatar">${avatarHtml(prof.name, look, 'xl')}</span>
      <div><b>${esc(prof.name)}</b><button type="button" class="btn small" id="look-av-btn">Change avatar</button></div>
    </div>
    <div class="look-preview"><div id="board"></div></div>
    <h2 class="section-title">Board</h2>
    <div class="look-grid" id="boards">${BOARDS.map(boardTile).join('')}</div>
    <p class="hint look-lockhint" id="hint-board" hidden></p>
    <h2 class="section-title">Pieces</h2>
    <div class="look-grid" id="pieces">${PIECE_SETS.map(pieceTile).join('')}</div>
    <p class="hint look-lockhint" id="hint-pieces" hidden></p>
    <h2 class="section-title">Unlock more</h2>
    <ul class="goals card">${MILESTONES.map(goalRow).join('')}</ul>
    <p class="hint center">Only you see your look — everyone in the family has their own.</p>
  </main>`;

  applyLook(look);
  const board = new Board(C.$('#board'), {});
  board.set({ fen: PREVIEW_FEN, lastMove: { from: 'd2', to: 'd3' } });

  // Saves run one after another so quick taps can't overwrite each other.
  let chain = Promise.resolve();
  const save = () => {
    chain = chain.then(() => saveProgress(p)).catch((e) => { console.warn(e); C.toast("Couldn't save — check the connection."); });
  };

  const pick = (kind, id) => {
    const list = kind === 'board' ? BOARDS : PIECE_SETS;
    const item = list.find((x) => x.id === id);
    const hint = C.$('#hint-' + kind);
    if (!isUnlocked(look, item)) {
      const m = milestone(item.unlock);
      hint.hidden = false;
      hint.textContent = `🔒 ${item.label}: ${m.label.toLowerCase()} to unlock it (${Math.min(m.have(p), m.need)} of ${m.need} ${m.unit} so far).`;
      return;
    }
    hint.hidden = true;
    look[kind] = id;
    C.app.querySelectorAll(`.look-tile[data-kind="${kind}"]`).forEach((t) => {
      const on = t.dataset.id === id;
      t.classList.toggle('on', on);
      t.setAttribute('aria-pressed', on);
    });
    applyLook(look);
    board.render();
    save();
  };
  C.app.querySelectorAll('.look-tile').forEach((t) => (t.onclick = () => pick(t.dataset.kind, t.dataset.id)));

  C.$('#look-av-btn').onclick = async () => {
    const res = await openAvatarPicker({ name: prof.name, look, first: false });
    if (!res) return;
    look.avatar = res.avatar;
    look.colour = res.colour;
    C.$('#look-avatar').innerHTML = avatarHtml(prof.name, look, 'xl');
    save();
  };
}
