// Storage layer. Everything the app saves goes through these functions, so the
// backend (this device only, or Supabase for cross-device sync) can be swapped
// without touching the rest of the app.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const PREFIX = 'ct.v1.';

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function lsDel(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- Local backend --------------------------------------------------------
const local = {
  name: 'device',
  async listProfiles() {
    return lsGet('profiles', []);
  },
  async saveProfile(p) {
    const all = lsGet('profiles', []);
    const i = all.findIndex((x) => x.id === p.id);
    if (i >= 0) all[i] = p; else all.push(p);
    lsSet('profiles', all);
    return p;
  },
  async deleteProfile(id) {
    lsSet('profiles', lsGet('profiles', []).filter((p) => p.id !== id));
    for (const g of lsGet('index.' + id, [])) lsDel('game.' + g.id);
    lsDel('index.' + id);
  },
  async listGames(profileId) {
    return lsGet('index.' + profileId, []).sort((a, b) => b.createdAt - a.createdAt);
  },
  async getGame(id) {
    return lsGet('game.' + id, null);
  },
  async saveGame(game) {
    game.updatedAt = Date.now();
    if (!lsSet('game.' + game.id, game)) {
      // Storage full: drop cached analysis lines of the oldest games and retry.
      throw new Error('This device is out of storage space for games.');
    }
    const idx = lsGet('index.' + game.profileId, []).filter((g) => g.id !== game.id);
    idx.push(summaryOf(game));
    lsSet('index.' + game.profileId, idx);
    return game;
  },
  async deleteGame(game) {
    lsDel('game.' + game.id);
    lsSet('index.' + game.profileId, lsGet('index.' + game.profileId, []).filter((g) => g.id !== game.id));
  },
};

// --- Supabase backend (REST, no extra library) --------------------------
function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
      ...(opts.headers || {}),
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  });
}

const supabase = {
  name: 'cloud',
  async listProfiles() {
    const rows = await sb('profiles?select=*&order=created_at');
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: Date.parse(r.created_at) }));
  },
  async saveProfile(p) {
    await sb('profiles', { method: 'POST', body: JSON.stringify({ id: p.id, name: p.name }) });
    return p;
  },
  async deleteProfile(id) {
    await sb(`games?profile_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    await sb(`profiles?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listGames(profileId) {
    const rows = await sb(`games?select=id,summary&profile_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc`);
    return rows.map((r) => r.summary);
  },
  async getGame(id) {
    const rows = await sb(`games?select=data&id=eq.${encodeURIComponent(id)}`);
    return rows[0] ? rows[0].data : null;
  },
  async saveGame(game) {
    game.updatedAt = Date.now();
    await sb('games', {
      method: 'POST',
      body: JSON.stringify({ id: game.id, profile_id: game.profileId, summary: summaryOf(game), data: game, created_at: new Date(game.createdAt).toISOString(), updated_at: new Date().toISOString() }),
    });
    return game;
  },
  async deleteGame(game) {
    await sb(`games?id=eq.${encodeURIComponent(game.id)}`, { method: 'DELETE' });
  },
};

export const cloudConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const store = cloudConfigured ? supabase : local;

// First run with Supabase switched on: copy anything saved on this device up to the cloud.
export async function migrateLocalToCloud() {
  if (!cloudConfigured || lsGet('migrated', false)) return 0;
  let n = 0;
  for (const p of await local.listProfiles()) {
    await supabase.saveProfile(p);
    for (const s of await local.listGames(p.id)) {
      const g = await local.getGame(s.id);
      if (g) { await supabase.saveGame(g); n++; }
    }
  }
  lsSet('migrated', true);
  return n;
}

export function summaryOf(game) {
  return {
    id: game.id,
    profileId: game.profileId,
    createdAt: game.createdAt,
    title: game.title,
    white: game.white,
    black: game.black,
    result: game.result,
    hero: game.hero,
    source: game.source,
    date: game.date,
    moves: game.moveCount,
    stats: game.stats || null,
    explained: Object.keys(game.notes || {}).length,
  };
}

// Small per-device preferences (e.g. last chosen profile).
export const prefs = {
  get: (k, d) => lsGet('pref.' + k, d),
  set: (k, v) => lsSet('pref.' + k, v),
};
