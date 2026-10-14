// Mobile-first chessboard: tap a piece, tap a square. No drag needed.
import { Chess } from '../vendor/chess.js';

const FILES = 'abcdefgh';
const PIECE_URL = (color, type) => new URL(`../img/pieces/${color}${type.toUpperCase()}.svg`, import.meta.url).href;

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.orientation = opts.orientation || 'w';
    this.onMove = opts.onMove || null;
    this.movable = opts.movable || null; // 'w' | 'b' | 'both' | null
    this.fen = new Chess().fen();
    this.lastMove = null;
    this.arrows = [];
    this.marks = {};
    this.selected = null;
    this.el.classList.add('board');
    this.el.innerHTML = '';
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.classList.add('board-arrows');
    this.promo = document.createElement('div');
    this.promo.className = 'promo hidden';
    this.el.append(this.grid, this.svg, this.promo);
    this.squares = {};
    this.grid.addEventListener('click', (e) => {
      const sq = e.target.closest('[data-sq]');
      if (sq) this._tap(sq.dataset.sq);
    });
    this._build();
    this.render();
  }

  _build() {
    this.grid.innerHTML = '';
    this.squares = {};
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const file = this.orientation === 'w' ? f : 7 - f;
        const rank = this.orientation === 'w' ? 7 - r : r;
        const sq = FILES[file] + (rank + 1);
        const d = document.createElement('div');
        d.className = 'sq ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
        d.dataset.sq = sq;
        if (f === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank + 1}</span>`);
        if (r === 7) d.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[file]}</span>`);
        this.grid.appendChild(d);
        this.squares[sq] = d;
      }
    }
  }

  setOrientation(c) {
    if (c === this.orientation) return;
    this.orientation = c;
    this._build();
    this.render();
  }

  flip() {
    this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
  }

  set({ fen, lastMove, arrows, movable, marks } = {}) {
    if (fen !== undefined) this.fen = fen;
    if (lastMove !== undefined) this.lastMove = lastMove;
    if (arrows !== undefined) this.arrows = arrows || [];
    if (movable !== undefined) this.movable = movable;
    if (marks !== undefined) this.marks = marks || {};
    this.selected = null;
    this._closePromo();
    this.render();
  }

  render() {
    const chess = new Chess(this.fen);
    const board = chess.board();
    const check = chess.inCheck() ? this._kingSq(chess, chess.turn()) : null;
    const dests = this.selected ? chess.moves({ square: this.selected, verbose: true }).map((m) => m.to) : [];
    for (const [sq, d] of Object.entries(this.squares)) {
      const f = FILES.indexOf(sq[0]);
      const r = 8 - +sq[1];
      const p = board[r][f];
      let pc = d.querySelector('.pc');
      if (p) {
        if (!pc) {
          pc = document.createElement('div');
          pc.className = 'pc';
          d.appendChild(pc);
        }
        const url = PIECE_URL(p.color, p.type);
        if (pc.dataset.url !== url) {
          pc.style.backgroundImage = `url("${url}")`;
          pc.dataset.url = url;
        }
        pc.setAttribute('aria-label', `${p.color === 'w' ? 'white' : 'black'} ${p.type}`);
      } else if (pc) pc.remove();
      d.classList.toggle('last', !!(this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq)));
      d.classList.toggle('sel', this.selected === sq);
      d.classList.toggle('dest', dests.includes(sq));
      d.classList.toggle('dest-cap', dests.includes(sq) && !!p);
      d.classList.toggle('check', check === sq);
      d.dataset.mark = this.marks[sq] || '';
    }
    this._drawArrows();
  }

  _kingSq(chess, color) {
    for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
    return null;
  }

  _center(sq) {
    let f = FILES.indexOf(sq[0]);
    let r = 8 - +sq[1];
    if (this.orientation === 'b') { f = 7 - f; r = 7 - r; }
    return [f + 0.5, r + 0.5];
  }

  _drawArrows() {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.innerHTML = '';
    const defs = document.createElementNS(ns, 'defs');
    for (const kind of ['best', 'threat', 'played', 'idea']) {
      const m = document.createElementNS(ns, 'marker');
      m.setAttribute('id', `ah-${kind}`);
      m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('refX', '5'); m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '2.6'); m.setAttribute('markerHeight', '2.6');
      m.setAttribute('orient', 'auto-start-reverse');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      path.setAttribute('class', `arrow-head ${kind}`);
      m.appendChild(path);
      defs.appendChild(m);
    }
    this.svg.appendChild(defs);
    for (const a of this.arrows) {
      const [x1, y1] = this._center(a.from);
      const [x2, y2] = this._center(a.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', x1 + (dx / len) * 0.15); l.setAttribute('y1', y1 + (dy / len) * 0.15);
      l.setAttribute('x2', x2 - (dx / len) * 0.35); l.setAttribute('y2', y2 - (dy / len) * 0.35);
      l.setAttribute('class', `arrow ${a.kind}`);
      l.setAttribute('marker-end', `url(#ah-${a.kind})`);
      this.svg.appendChild(l);
    }
  }

  _canMove(color) {
    return this.movable === 'both' || this.movable === color;
  }

  _tap(sq) {
    if (!this.movable) return;
    const chess = new Chess(this.fen);
    const p = chess.get(sq);
    if (this.selected) {
      if (sq === this.selected) { this.selected = null; this.render(); return; }
      const moves = chess.moves({ square: this.selected, verbose: true }).filter((m) => m.to === sq);
      if (moves.length) {
        const from = this.selected;
        if (moves.some((m) => m.promotion)) this._askPromo(from, sq, chess.turn());
        else this._emit(from + sq);
        return;
      }
    }
    if (p && p.color === chess.turn() && this._canMove(p.color)) {
      this.selected = sq;
    } else {
      this.selected = null;
    }
    this.render();
  }

  _askPromo(from, to, color) {
    this.promo.innerHTML = '';
    for (const t of ['q', 'r', 'b', 'n']) {
      const b = document.createElement('button');
      b.className = 'promo-btn';
      b.style.backgroundImage = `url("${PIECE_URL(color, t)}")`;
      b.setAttribute('aria-label', { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[t]);
      b.onclick = (e) => { e.stopPropagation(); this._closePromo(); this._emit(from + to + t); };
      this.promo.appendChild(b);
    }
    this.promo.classList.remove('hidden');
  }

  _closePromo() {
    this.promo.classList.add('hidden');
  }

  _emit(uci) {
    this.selected = null;
    if (this.onMove) this.onMove(uci);
    this.render();
  }
}
