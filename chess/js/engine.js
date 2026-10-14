// Stockfish wrapper: one worker, one job at a time, promise-based.
// Scores are returned from the point of view of the side to move.

const ENGINE_URL = new URL('../engine/stockfish-18-lite-single.js', import.meta.url).href;

class Engine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.queue = [];
    this.busy = false;
    this.listener = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(ENGINE_URL);
      } catch (e) {
        reject(e);
        return;
      }
      this.worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (this.listener) this.listener(line);
      };
      this.worker.onerror = (e) => reject(e);
      this.listener = (line) => {
        if (line === 'uciok') this.send('isready');
        if (line === 'readyok') {
          this.listener = null;
          resolve();
        }
      };
      this.send('uci');
    });
    return this.ready;
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  // analyse(fen, {depth, multipv, movetime, searchmoves})
  analyse(fen, opts = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject });
      this._next();
    });
  }

  // Drop everything still waiting (e.g. user left the review screen).
  clearQueue() {
    for (const job of this.queue) job.reject(new Error('cancelled'));
    this.queue = [];
  }

  async _next() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const job = this.queue.shift();
    try {
      await this.start();
      const result = await this._run(job.fen, job.opts);
      job.resolve(result);
    } catch (e) {
      job.reject(e);
    } finally {
      this.busy = false;
      this._next();
    }
  }

  _run(fen, { depth = 14, multipv = 1, movetime, searchmoves } = {}) {
    return new Promise((resolve) => {
      const lines = new Map();
      this.listener = (line) => {
        if (line.startsWith('info') && line.includes(' pv ')) {
          const info = parseInfo(line);
          if (info) lines.set(info.multipv, info);
        } else if (line.startsWith('bestmove')) {
          this.listener = null;
          const best = line.split(' ')[1];
          const out = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
          resolve({ fen, bestmove: best === '(none)' ? null : best, lines: out });
        }
      };
      this.send('ucinewgame');
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      let go = movetime ? `go movetime ${movetime}` : `go depth ${depth}`;
      if (searchmoves && searchmoves.length) go += ` searchmoves ${searchmoves.join(' ')}`;
      this.send(go);
    });
  }
}

function parseInfo(line) {
  const t = line.split(' ');
  const info = { multipv: 1 };
  for (let i = 0; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') info.depth = +t[++i];
    else if (k === 'multipv') info.multipv = +t[++i];
    else if (k === 'score') {
      const kind = t[++i];
      const val = +t[++i];
      if (kind === 'cp') info.cp = val;
      else if (kind === 'mate') info.mate = val;
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') return null;
    } else if (k === 'pv') {
      info.pv = t.slice(i + 1);
      break;
    }
  }
  if (!info.pv || (info.cp === undefined && info.mate === undefined)) return null;
  return info;
}

export const engine = new Engine();
