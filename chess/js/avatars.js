// Player avatars: an icon on a coloured circle, chosen per player.
// Stored in the player's progress record as `look: { avatar, colour }`, so it
// follows them across devices like the rest of their progress.
// (Later personalisation — board colours, piece sets — will sit in `look` too.)

// ︎ keeps the chess glyphs as plain text rather than turning one into an emoji.
export const AVATARS = [
  { id: 'king', icon: '♚︎', label: 'King' },
  { id: 'queen', icon: '♛︎', label: 'Queen' },
  { id: 'rook', icon: '♜︎', label: 'Rook' },
  { id: 'bishop', icon: '♝︎', label: 'Bishop' },
  { id: 'knight', icon: '♞︎', label: 'Knight' },
  { id: 'pawn', icon: '♟︎', label: 'Pawn' },
  { id: 'fox', icon: '🦊', label: 'Fox' },
  { id: 'owl', icon: '🦉', label: 'Owl' },
  { id: 'panda', icon: '🐼', label: 'Panda' },
  { id: 'tiger', icon: '🐯', label: 'Tiger' },
  { id: 'lion', icon: '🦁', label: 'Lion' },
  { id: 'cat', icon: '🐱', label: 'Cat' },
  { id: 'dog', icon: '🐶', label: 'Dog' },
  { id: 'koala', icon: '🐨', label: 'Koala' },
  { id: 'penguin', icon: '🐧', label: 'Penguin' },
  { id: 'frog', icon: '🐸', label: 'Frog' },
  { id: 'turtle', icon: '🐢', label: 'Turtle' },
  { id: 'octopus', icon: '🐙', label: 'Octopus' },
  { id: 'unicorn', icon: '🦄', label: 'Unicorn' },
  { id: 'dragon', icon: '🐲', label: 'Dragon' },
  { id: 'rocket', icon: '🚀', label: 'Rocket' },
  { id: 'star', icon: '🌟', label: 'Star' },
  { id: 'football', icon: '⚽', label: 'Football' },
  { id: 'guitar', icon: '🎸', label: 'Guitar' },
];

// Background colours. All dark enough for the white chess glyphs to read.
export const COLOURS = [
  { id: 'forest', hex: '#1f2a24', label: 'Forest' },
  { id: 'teal', hex: '#17756f', label: 'Teal' },
  { id: 'blue', hex: '#2f63a8', label: 'Blue' },
  { id: 'purple', hex: '#6a4bb8', label: 'Purple' },
  { id: 'pink', hex: '#b83f78', label: 'Pink' },
  { id: 'coral', hex: '#c9523d', label: 'Coral' },
  { id: 'gold', hex: '#a57a24', label: 'Gold' },
  { id: 'slate', hex: '#4e5a63', label: 'Slate' },
];

const byId = (list, id) => list.find((x) => x.id === id) || null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const hasAvatar = (look) => !!(look && byId(AVATARS, look.avatar));

// The circle itself. No avatar chosen yet → the first letter of their name, as before.
export function avatarHtml(name, look, cls = '') {
  const a = look && byId(AVATARS, look.avatar);
  const c = (look && byId(COLOURS, look.colour)) || COLOURS[0];
  const style = a ? ` style="background:${c.hex}"` : '';
  const inner = a ? esc(a.icon) : esc((name || '?')[0] || '?');
  return `<span class="avatar${a ? ' has-icon' : ''}${cls ? ' ' + cls : ''}"${style} aria-hidden="true">${inner}</span>`;
}

// Picker sheet. Resolves with the chosen look, 'skip' (first-time prompt
// dismissed with "Skip for now") or null (cancelled).
export function openAvatarPicker({ name, look, first = false }) {
  return new Promise((resolve) => {
    let avatar = (look && look.avatar) || (first ? AVATARS[6].id : null);
    let colour = (look && look.colour) || COLOURS[1].id;
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="av-title">
      <div class="av-preview"></div>
      <h2 id="av-title">${first ? `Pick your avatar, ${esc(name)}` : `${esc(name)}'s avatar`}</h2>
      <p class="hint center">${first ? 'It shows when you choose who\'s playing. You can change it any time.' : 'Shows when you choose who\'s playing.'}</p>
      <div class="av-grid" role="radiogroup" aria-label="Avatar">
        ${AVATARS.map((a) => `<button type="button" class="av-pick" role="radio" data-id="${a.id}" aria-label="${a.label}">${a.icon}</button>`).join('')}
      </div>
      <div class="av-colours" role="radiogroup" aria-label="Colour">
        ${COLOURS.map((c) => `<button type="button" class="av-colour" role="radio" data-id="${c.id}" aria-label="${c.label}" style="background:${c.hex}"></button>`).join('')}
      </div>
      <div class="actions av-actions">
        <button type="button" class="btn primary av-save">Save</button>
        <button type="button" class="btn ghost av-cancel">${first ? 'Skip for now' : 'Cancel'}</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('sheet-open');
    const q = (s) => wrap.querySelector(s);

    const paint = () => {
      q('.av-preview').innerHTML = avatarHtml(name, avatar ? { avatar, colour } : null, 'xl');
      const hex = byId(COLOURS, colour).hex;
      wrap.querySelectorAll('.av-pick').forEach((b) => {
        const on = b.dataset.id === avatar;
        b.setAttribute('aria-checked', on);
        b.style.background = on ? hex : '';
      });
      wrap.querySelectorAll('.av-colour').forEach((b) => b.setAttribute('aria-checked', b.dataset.id === colour));
      q('.av-save').disabled = !avatar;
    };
    const close = (val) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      document.body.classList.remove('sheet-open');
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(first ? 'skip' : null); };
    document.addEventListener('keydown', onKey);

    wrap.querySelectorAll('.av-pick').forEach((b) => (b.onclick = () => { avatar = b.dataset.id; paint(); }));
    wrap.querySelectorAll('.av-colour').forEach((b) => (b.onclick = () => { colour = b.dataset.id; paint(); }));
    q('.av-save').onclick = () => close({ ...(look || {}), avatar, colour });
    q('.av-cancel').onclick = () => close(first ? 'skip' : null);
    wrap.onclick = (e) => { if (e.target === wrap) close(first ? 'skip' : null); };
    paint();
    q(avatar ? `.av-pick[data-id="${avatar}"]` : '.av-pick').focus();
  });
}
