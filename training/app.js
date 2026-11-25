/* Set & Pulse: family training log. Plain JS, no build step. */
(function () {
"use strict";

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const DAY = 864e5;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDate = ms => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtShort = ms => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtTime = ms => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmtDur = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}:${String(r).padStart(2, "0")}`; };
const fmtNum = (n, d = 0) => (n == null || isNaN(n)) ? "–" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: d });
const dayStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const parseDay = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }
const ls = {
  get(k, f) { try { const v = localStorage.getItem("sp1." + k); return v ? JSON.parse(v) : f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem("sp1." + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem("sp1." + k); } catch { } }
};
function confirmBtn(btn, label, fn) { // two-tap confirm, no dialogs
  let armed = false; const orig = btn.textContent;
  btn.onclick = () => { if (!armed) { armed = true; btn.textContent = label; setTimeout(() => { armed = false; btn.textContent = orig; }, 3500); return; } fn(); };
}
const ICON = {
  row: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17h18M6 17l4-8 5 3 3-5"/><circle cx="10" cy="7" r="2"/></svg>`,
  strength: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>`,
  free: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>`
};

/* ---------------- API ---------------- */
const API_OK = typeof SUPABASE_URL === "string" && /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_KEY;
async function api(fn, args = {}) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (!SUPABASE_KEY.startsWith("sb_")) headers.Authorization = "Bearer " + SUPABASE_KEY;
  let res;
  try { res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) }); }
  catch (e) { const err = new Error("offline"); err.offline = true; throw err; }
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && body.message) || res.statusText || "error";
    const err = new Error(msg); err.code = msg; err.status = res.status;
    if (msg === "signed_out") { signOutLocal(); }
    throw err;
  }
  return body;
}

/* ---------------- state ---------------- */
const S = { people: [], uidCur: null, token: null, me: null, progs: [], logs: [], loaded: false, pending: null, syncing: false, offline: false };
function pendKey() { return "pending." + S.uidCur; }
function loadPending() { S.pending = ls.get(pendKey(), { logs: {}, progs: {}, delLogs: [], delProgs: [], settings: null }); }
function savePending() { ls.set(pendKey(), S.pending); }
function hasPending() { const p = S.pending; return p && (Object.keys(p.logs).length || Object.keys(p.progs).length || p.delLogs.length || p.delProgs.length || p.settings); }
function cacheData() { ls.set("cache." + S.uidCur, { me: S.me, progs: S.progs, logs: S.logs.slice(0, 300) }); }

function saveLog(log) {
  log.updatedAt = Date.now();
  const i = S.logs.findIndex(l => l.id === log.id);
  if (i >= 0) S.logs[i] = log; else S.logs.unshift(log);
  S.logs.sort((a, b) => b.startedAt - a.startedAt);
  S.pending.logs[log.id] = log; savePending(); cacheData(); flushSoon();
}
function deleteLog(id) {
  S.logs = S.logs.filter(l => l.id !== id); delete S.pending.logs[id];
  S.pending.delLogs.push(id); savePending(); cacheData(); flushSoon();
}
function saveProg(p) {
  p.updatedAt = Date.now();
  const i = S.progs.findIndex(x => x.id === p.id);
  if (i >= 0) S.progs[i] = p; else S.progs.push(p);
  S.pending.progs[p.id] = p; savePending(); cacheData(); flushSoon();
}
function deleteProg(id) {
  S.progs = S.progs.filter(p => p.id !== id); delete S.pending.progs[id];
  S.pending.delProgs.push(id); savePending(); cacheData(); flushSoon();
}
function saveSettings(st) { S.me.settings = st; S.pending.settings = st; savePending(); cacheData(); flushSoon(); }

let flushT;
function flushSoon(ms = 400) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
async function flush() {
  if (S.syncing) { S.again = true; return; }
  if (!S.token || !S.pending) return;
  S.syncing = true;
  const P = S.pending;
  try {
    for (const id of Object.keys(P.progs)) { const p = P.progs[id]; await api("fit_save_programme", { p_token: S.token, p_data: p }); if (P.progs[id] === p) delete P.progs[id]; savePending(); }
    for (const id of Object.keys(P.logs)) { const l = P.logs[id]; await api("fit_save_log", { p_token: S.token, p_data: l }); if (P.logs[id] === l) delete P.logs[id]; savePending(); }
    while (P.delLogs.length) { await api("fit_delete_log", { p_token: S.token, p_id: P.delLogs[0] }); P.delLogs.shift(); savePending(); }
    while (P.delProgs.length) { await api("fit_delete_programme", { p_token: S.token, p_id: P.delProgs[0] }); P.delProgs.shift(); savePending(); }
    if (P.settings) { const st = P.settings; await api("fit_save_settings", { p_token: S.token, p_settings: st }); if (P.settings === st) P.settings = null; savePending(); }
    S.offline = false;
  } catch (e) {
    if (e.offline) S.offline = true;
    else if (e.code !== "signed_out") toast("Couldn't save: " + e.message);
  }
  S.syncing = false; syncPill();
  if (S.again) { S.again = false; if (hasPending()) return flushSoon(100); }
  if (hasPending()) { clearTimeout(flushT); flushT = setTimeout(flush, S.offline ? 20000 : 3000); }
}
window.addEventListener("online", () => flushSoon(100));
function syncPill() {
  const p = $("#syncPill"); if (!p) return;
  if (hasPending()) { p.hidden = false; p.className = "pill warn"; p.textContent = S.offline ? "Saved on phone" : "Saving…"; }
  else p.hidden = true;
}

/* ---------------- auth ---------------- */
function tokens() { return ls.get("tokens", {}); }
function signOutLocal() { const t = tokens(); delete t[S.uidCur]; ls.set("tokens", t); S.token = null; S.me = null; S.loaded = false; ls.del("current"); location.hash = "who"; }
async function openUser(id) {
  const t = tokens()[id]; if (!t) { location.hash = "pin-" + id; return; }
  S.uidCur = id; S.token = t; ls.set("current", id); loadPending();
  const cached = ls.get("cache." + id, null);
  if (cached) { S.me = cached.me; S.progs = cached.progs; S.logs = cached.logs; S.loaded = true; }
  try {
    const d = await api("fit_load", { p_token: t });
    S.me = d.user; S.progs = d.programmes || []; S.logs = d.logs || []; S.loaded = true; S.offline = false;
    // pending local changes win over what the server sent
    for (const p of Object.values(S.pending.progs)) { const i = S.progs.findIndex(x => x.id === p.id); if (i >= 0) S.progs[i] = p; else S.progs.push(p); }
    for (const l of Object.values(S.pending.logs)) { const i = S.logs.findIndex(x => x.id === l.id); if (i >= 0) S.logs[i] = l; else S.logs.push(l); }
    S.logs = S.logs.filter(l => !S.pending.delLogs.includes(l.id)).sort((a, b) => b.startedAt - a.startedAt);
    S.progs = S.progs.filter(p => !S.pending.delProgs.includes(p.id));
    if (S.pending.settings) S.me.settings = S.pending.settings;
    cacheData(); flushSoon(200);
  } catch (e) {
    if (e.code === "signed_out") return;
    if (e.offline && cached) { S.offline = true; toast("No connection. Showing what's saved on this phone."); }
    else if (!cached) { S.loaded = false; throw e; }
  }
}

/* ---------------- training maths ---------------- */
const isTimed = ex => ex.measure === "secs";
const e1rm = (w, r) => (w > 0 && r > 0 && r <= 12) ? w * (1 + r / 30) : 0;
function logVolume(log) { return (log.sets || []).reduce((a, s) => a + ((s.measure !== "secs" && s.weight > 0) ? s.weight * s.reps : 0), 0); }
function hrSeries(log) { const f = log.hr || [], t0 = log.hrT0 || 0, out = []; for (let i = 0; i + 1 < f.length; i += 2) out.push([t0 + f[i] * 1000, f[i + 1]]); return out; }
const DEFAULT_MAX = 180;
function maxHr() { const m = S.me && S.me.settings && S.me.settings.maxHr; return m > 0 ? m : DEFAULT_MAX; }
const ZONES = [[.5, .6, "Zone 1"], [.6, .7, "Zone 2"], [.7, .8, "Zone 3"], [.8, .9, "Zone 4"], [.9, 9, "Zone 5"]];
function hrStats(log, target) {
  const hr = hrSeries(log); if (hr.length < 2) return null;
  const mx = maxHr(); let wsum = 0, tsum = 0, peak = 0, inT = 0; const zmin = [0, 0, 0, 0, 0];
  for (let i = 0; i < hr.length; i++) {
    const dt = i < hr.length - 1 ? Math.min(60, (hr[i + 1][0] - hr[i][0]) / 1000) : 5;
    const b = hr[i][1]; wsum += b * dt; tsum += dt; peak = Math.max(peak, b);
    const p = b / mx; ZONES.forEach((z, k) => { if (p >= z[0] && p < z[1]) zmin[k] += dt / 60; });
    if (target && b >= target[0] && b <= target[1]) inT += dt;
  }
  return { avg: wsum / tsum, peak, zmin, trimp: zmin.reduce((a, m, k) => a + m * (k + 1), 0), minutes: tsum / 60, inTarget: target ? inT / tsum : null };
}
function nearestBpm(hr, t, maxGap = 20000) { let best = null, bd = Infinity; for (const [ts, b] of hr) { const d = Math.abs(ts - t); if (d < bd) { bd = d; best = b; } } return bd <= maxGap ? best : null; }
function setEffort(log) {
  const hr = hrSeries(log); const sets = [...(log.sets || [])].sort((a, b) => a.t - b.t);
  return sets.map((s, i) => {
    if (!hr.length) return { s, peak: null, drop: null };
    const prev = i > 0 ? sets[i - 1].t : s.t - 180000, from = Math.max(prev, s.t - 120000), to = s.t + 15000;
    let peak = null, pt = null;
    for (const [ts, b] of hr) if (ts >= from && ts <= to && (peak == null || b > peak)) { peak = b; pt = ts; }
    let drop = null;
    if (peak != null) { const next = sets[i + 1]?.t ?? Infinity; if (pt + 60000 < next) { const b60 = nearestBpm(hr, pt + 60000); if (b60 != null) drop = peak - b60; } }
    return { s, peak, drop };
  });
}
function parseHr(text, from, to) {
  // Fast shortcut format: all the times, a line with ---, then all the heart rates in the same order.
  const blocks = String(text || "").split(/\r?\n\s*-{3,}\s*\r?\n/);
  if (blocks.length === 2) {
    const ts = blocks[0].split(/\r?\n/).map(x => x.trim()).filter(Boolean), bs = blocks[1].split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (ts.length && ts.length === bs.length) text = ts.map((t, i) => t + "," + bs[i]).join("\n");
  }
  const re = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?/;
  const reUK = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  const out = []; let total = 0;
  String(text || "").split(/\r?\n/).forEach(line => {
    let t, rest; const m = line.match(re);
    if (m) { let tz = m[3] || ""; if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ":" + tz.slice(3); t = Date.parse(`${m[1]}T${m[2]}${tz}`); rest = line.slice(m.index + m[0].length); }
    else { const u = line.match(reUK); if (!u) return; t = new Date(+u[3], +u[2] - 1, +u[1], +u[4], +u[5], +(u[6] || 0)).getTime(); rest = line.slice(u.index + u[0].length); }
    if (isNaN(t)) return;
    const n = rest.match(/(\d+(?:[.,]\d+)?)/); if (!n) return;
    const b = parseFloat(n[1].replace(",", ".")); if (!(b >= 30 && b <= 240)) return;
    total++; if (t >= from && t <= to) out.push([t, b]);
  });
  out.sort((a, b) => a[0] - b[0]);
  return { total, kept: out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]) };
}
function setText(s) { return s.measure === "secs" ? `${fmtNum(s.reps)} s${s.weight > 0 ? ` @ ${fmtNum(s.weight, 2)} kg` : ""}` : `${s.weight > 0 ? fmtNum(s.weight, 2) + " kg" : "BW"} × ${fmtNum(s.reps)}`; }
function repsText(t, ex) { const r = t.repsFrom && t.repsFrom < t.reps ? `${t.repsFrom}–${t.reps}` : `${t.reps}`; return `${r}${isTimed(ex) ? " s" : ""}`; }
function targetText(ex, t) { t = t || ex; return `${t.sets || 0} × ${repsText(t, ex)}${t.weight > 0 ? ` @ ${fmtNum(t.weight, 2)} kg` : ""}${t.rest ? ` · rest ${fmtDur(t.rest)}` : ""}`; }
function pace500(seconds, metres) { return metres > 0 ? fmtDur(seconds / (metres / 500)) : "–"; }

/* ---------------- programme logic ---------------- */
function progStart(p) { return parseDay(p.startDate); }
function progWeek(p, now = Date.now()) { return Math.floor((dayStart(now) - progStart(p)) / (7 * DAY)) + 1; }
function progEnd(p) { return addDays(progStart(p), (p.weeks || 4) * 7 - 1); }
function weekDef(sess, n) { const ws = sess.weeks || []; return ws.find(w => w.n === n) || [...ws].reverse().find(w => w.n <= n) || ws[0] || { n, ex: {}, parts: [] }; }
function weekLabel(p, n) { return p.weekLabels && p.weekLabels[n] ? p.weekLabels[n] : ""; }
function schedule(p, week) {
  const ws = addDays(progStart(p), (week - 1) * 7), wd = new Date(ws).getDay(), out = [];
  (p.sessions || []).forEach(s => (s.days || []).forEach(d => out.push({ sess: s, week, date: addDays(ws, (d - wd + 7) % 7) })));
  return out.sort((a, b) => a.date - b.date);
}
function doneLog(p, key, week) { return S.logs.find(l => l.programmeId === p.id && l.sessionKey === key && l.week === week && l.status === "done"); }
function activeLog() { return S.logs.find(l => l.status === "active"); }
function statusOf(item) {
  const today = dayStart(Date.now());
  if (doneLog(item.prog || item.p, item.sess.key, item.week)) return "done";
  if (item.date < today) return "missed";
  if (item.date === today) return "today";
  return "upcoming";
}
function todayPlan(p) {
  const w = progWeek(p), weeks = p.weeks || 4;
  if (w < 1) return { state: "before", startsIn: Math.round((progStart(p) - dayStart(Date.now())) / DAY) };
  if (w > weeks) return { state: "finished" };
  const items = schedule(p, w).map(i => ({ ...i, p, st: statusOf({ ...i, p }) }));
  let next = items.find(i => i.st === "upcoming");
  if (!next && w < weeks) next = schedule(p, w + 1).map(i => ({ ...i, p, st: "upcoming" }))[0];
  return { state: "on", week: w, missed: items.filter(i => i.st === "missed"), today: items.filter(i => i.st === "today"), next, items };
}
function reviewInfo(p) {
  const every = (p.reviewEvery || 4) * 7, since = Math.max(0, Math.round((dayStart(Date.now()) - progStart(p)) / DAY));
  const k = Math.floor(since / every) + 1, date = addDays(progStart(p), k * every);
  return { date, days: Math.round((date - dayStart(Date.now())) / DAY) };
}
function progCounts(p) {
  const w = Math.min(progWeek(p), p.weeks || 4); let planned = 0, done = 0;
  for (let i = 1; i <= w; i++) schedule(p, i).forEach(it => { if (it.date <= dayStart(Date.now())) { planned++; if (doneLog(p, it.sess.key, i)) done++; } });
  const total = (p.weeks || 4) * (p.sessions || []).reduce((a, s) => a + (s.days || []).length, 0);
  const allDone = S.logs.filter(l => l.programmeId === p.id && l.status === "done").length;
  return { planned, done, total, allDone };
}
function sessRoute(p, s, week) { return `#sess-${p.id}~${s.key}~${week}`; }

/* ---------------- routing ---------------- */
let restTick = null;
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
function parts() { const h = decodeURIComponent((location.hash || "").slice(1)); const i = h.indexOf("-"); return i < 0 ? [h, ""] : [h.slice(0, i), h.slice(i + 1)]; }
function setTab(name) { $$("#tabs a").forEach(a => a.toggleAttribute("aria-current", false)); const a = $(`#tabs a[data-tab="${name}"]`); if (a) a.setAttribute("aria-current", "page"); }
function topBar(title, back, sub) {
  const me = S.me;
  return `<header class="top">${back ? `<a class="btn ghost back" href="${back}" aria-label="Back">←</a>` : ""}<div class="title">${sub ? `<div class="eyebrow">${esc(sub)}</div>` : ""}<h1>${esc(title)}</h1></div>
    <span id="syncPill" class="pill warn" hidden></span>${me ? `<a class="me-chip" href="#me"><span class="av s c-${esc(me.colour || "blue")}">${esc(me.name[0])}</span>${esc(me.name)}</a>` : ""}</header>`;
}
async function render() {
  clearInterval(restTick);
  const app = $("#app"); const [view, arg] = parts();
  if (!API_OK) { app.innerHTML = `<div class="card stack"><h2>Not set up yet</h2><p class="muted">Add the Supabase address and key at the top of index.html.</p></div>`; return; }
  if (view === "who" || view === "pin" || !S.uidCur && !ls.get("current", null)) {
    $("#tabs").hidden = true;
    if (view === "pin") return renderPin(app, arg);
    return renderWho(app);
  }
  if (!S.loaded || !S.me) {
    const cur = S.uidCur || ls.get("current", null);
    app.innerHTML = `<div class="card empty">Loading…</div>`;
    try { await openUser(cur); } catch (e) { app.innerHTML = `<div class="card stack"><h2>Can't load your training</h2><p class="muted">${esc(e.offline ? "No internet connection. Check your signal and try again." : e.message)}</p><button class="primary" onclick="location.reload()">Try again</button><a class="btn" href="#who">Switch person</a></div>`; return; }
    if (!S.me) return;
  }
  $("#tabs").hidden = false;
  const views = { home: renderHome, prog: renderProg, sess: renderSessPreview, live: renderLive, log: renderLog, history: renderHistory, fitness: renderFitness, pprog: renderProgProgress, me: renderMe, edit: renderEdit, rowform: renderRowForm, import: renderImport };
  const fn = views[view] || renderHome;
  setTab({ home: "home", prog: "home", sess: "home", live: "home", pprog: "home", edit: "home", rowform: "home", import: "home", history: "history", log: "history", fitness: "fitness", me: "me" }[view] || "home");
  fn(app, arg);
  syncPill();
}

/* ---------------- who + pin ---------------- */
async function renderWho(app) {
  app.innerHTML = `<header class="top"><div class="title"><div class="eyebrow">Set &amp; Pulse</div><h1>Who's training?</h1></div></header><div class="people" id="people"><div class="card empty" style="grid-column:1/-1">Loading…</div></div>`;
  try { S.people = await api("fit_people"); ls.set("people", S.people); }
  catch (e) { S.people = ls.get("people", []); if (!S.people.length) { $("#people").innerHTML = `<div class="card stack" style="grid-column:1/-1"><p>${e.offline ? "No internet connection." : "Can't reach the training database. If this is the first time, run the setup script in Supabase."}</p><button onclick="location.reload()">Try again</button></div>`; return; } }
  $("#people").innerHTML = S.people.map(p => `<a class="person" href="#" data-u="${esc(p.id)}"><span class="av l c-${esc(p.colour || "blue")}">${esc(p.name[0])}</span>${esc(p.name)}</a>`).join("");
  $$("#people [data-u]").forEach(a => a.onclick = async e => { e.preventDefault(); const id = a.dataset.u; if (tokens()[id]) { S.uidCur = id; S.loaded = false; ls.set("current", id); location.hash = "home"; } else location.hash = "pin-" + id; });
}
function renderPin(app, id) {
  const person = (S.people.length ? S.people : ls.get("people", [])).find(p => p.id === id) || { id, name: id, colour: "blue", hasPin: true };
  let pin = "", first = "", stage = person.hasPin ? "enter" : "new";
  const draw = msg => {
    const head = stage === "enter" ? "Enter your PIN" : stage === "new" ? "Choose a 4-digit PIN" : "Type it again to confirm";
    app.innerHTML = `<header class="top"><a class="btn ghost back" href="#who" aria-label="Back">←</a><div class="title"><div class="eyebrow">Set &amp; Pulse</div><h1>${esc(person.name)}</h1></div></header>
      <div class="stack" style="align-items:center;text-align:center"><span class="av l c-${esc(person.colour || "blue")}">${esc(person.name[0])}</span><h2>${head}</h2>
      ${stage !== "enter" ? `<p class="small muted">You'll use this PIN to open your training on any phone. Don't share it.</p>` : ""}
      <div class="pin-dots" aria-label="${pin.length} of 4 digits entered">${[0, 1, 2, 3].map(i => `<i class="${i < pin.length ? "on" : ""}"></i>`).join("")}</div>
      <p class="small" id="pinMsg" style="min-height:20px;color:var(--pulse)">${esc(msg || "")}</p>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join("")}<span></span><button data-k="0">0</button><button data-k="del" aria-label="Delete">⌫</button></div></div>`;
    $$(".pad [data-k]").forEach(b => b.onclick = () => press(b.dataset.k));
  };
  const press = async k => {
    if (k === "del") { pin = pin.slice(0, -1); return draw(); }
    if (pin.length >= 4) return; pin += k; draw();
    if (pin.length < 4) return;
    if (stage === "new") { first = pin; pin = ""; stage = "confirm"; return draw(); }
    if (stage === "confirm" && pin !== first) { pin = ""; first = ""; stage = "new"; return draw("Those didn't match. Choose your PIN again."); }
    try {
      const r = await api("fit_login", { p_user: id, p_pin: pin });
      if (r.ok) { const t = tokens(); t[id] = r.token; ls.set("tokens", t); S.uidCur = id; S.loaded = false; ls.set("current", id); location.hash = "home"; if (r.firstTime) toast("PIN set. Welcome, " + person.name + "!"); return; }
      pin = ""; draw(r.locked ? `Too many wrong tries. Try again in ${r.minutes} minutes.` : `Wrong PIN. ${plural(r.triesLeft, "try")} left before a 15-minute lock.`);
    } catch (e) { pin = ""; draw(e.offline ? "No internet connection." : e.message); }
  };
  draw();
}

/* ---------------- HOME ---------------- */
function todayCards(p) {
  const tp = todayPlan(p);
  if (tp.state === "before") return `<div class="card"><div class="eyebrow">${esc(p.name)}</div><p>Starts in ${plural(tp.startsIn, "day")}, ${fmtDate(progStart(p))}.</p></div>`;
  if (tp.state === "finished") return `<div class="card"><div class="eyebrow">${esc(p.name)}</div><p><b>Programme finished.</b> Time for the review and a new plan.</p></div>`;
  let h = "";
  tp.missed.forEach(i => h += sessCard(p, i, "missed"));
  tp.today.forEach(i => h += sessCard(p, i, "today"));
  if (!tp.missed.length && !tp.today.length) h += `<div class="card"><div class="eyebrow">${esc(p.name)} · Rest day</div>${tp.next ? `<p>Next: <a href="${sessRoute(p, tp.next.sess, tp.next.week)}"><b>${esc(tp.next.sess.name)}</b></a> on ${fmtDate(tp.next.date)}.</p>` : "<p>Nothing else this week.</p>"}</div>`;
  return h;
}
function sessCard(p, i, st, inProg) {
  const label = st === "missed" ? `<span class="pill warn">${inProg ? "Missed" : `Missed ${DOW[new Date(i.date).getDay()]}, catch up`}</span>` : st === "today" ? `<span class="pill live">Today</span>` : st === "done" ? `<span class="pill good">Done</span>` : inProg || !i.date ? "" : `<span class="pill">${fmtDate(i.date)}</span>`;
  const wd = weekDef(i.sess, i.week);
  const sum = i.sess.kind === "row" ? (wd.parts || []).map(x => x.part).join(" · ") : `${(i.sess.exercises || []).length} exercises`;
  return `<a class="card link sess${st === "today" || st === "missed" ? " hi" : ""}" href="${sessRoute(p, i.sess, i.week)}"><span class="kind">${ICON[i.sess.kind] || ICON.free}</span><div class="meta grow"><div class="eyebrow">${inProg ? (i.date ? fmtDate(i.date) : "Any day") : `${esc(p.name)} · Week ${i.week}`}</div><h3>${esc(i.sess.name)}</h3><p class="small muted">${esc(i.sess.focus || "")}${sum ? " · " + esc(sum) : ""}</p></div>${label}</a>`;
}
function renderHome(app) {
  const live = activeLog();
  let h = topBar(`Hi, ${S.me.name}`, null, new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })) + `<div class="stack">`;
  if (live) h += `<a class="card link sess hi" href="#live"><span class="kind">${ICON.strength}</span><div class="meta grow"><div class="eyebrow">In progress since ${fmtTime(live.startedAt)}</div><h3>${esc(live.name)}</h3></div><span class="btn primary">Continue</span></a>`;
  const active = S.progs.filter(p => !p.archived);
  if (active.length) {
    h += `<section class="stack tight"><h2>Today's session</h2>${active.map(todayCards).join("")}</section>`;
    h += `<section class="stack tight"><h2>Your programmes</h2>`;
    active.forEach(p => {
      const w = progWeek(p), c = progCounts(p), rv = reviewInfo(p);
      const wtxt = w < 1 ? "Not started" : w > (p.weeks || 4) ? "Finished" : `Week ${w} of ${p.weeks || 4}${weekLabel(p, w) ? " · " + weekLabel(p, w) : ""}`;
      h += `<a class="card link stack tight" href="#prog-${esc(p.id)}"><div class="row between nowrap"><h3>${esc(p.name)}</h3><span class="pill">Review in ${plural(rv.days, "day")}</span></div><p class="small muted">${esc(wtxt)} · ${c.allDone} of ${c.total} sessions done</p><div class="bar"><i style="width:${Math.min(100, c.allDone / Math.max(1, c.total) * 100)}%"></i></div></a>`;
    });
    h += `</section>`;
  } else {
    h += `<div class="card flat empty stack"><h3>No programme yet</h3><p>Create your own, or import one Tiago or Claude has made for you.</p></div>`;
  }
  h += `<div class="row"><a class="btn" href="#edit-new">+ New programme</a><a class="btn" href="#import">Import a file</a><a class="btn ghost" href="#sess-free">Free session</a></div></div>`;
  app.innerHTML = h;
}

/* ---------------- PROGRAMME ---------------- */
let progWeekSel = {};
function renderProg(app, id) {
  const p = S.progs.find(x => x.id === id); if (!p) { location.hash = "home"; return; }
  const w = progWeek(p), weeks = p.weeks || 4, rv = reviewInfo(p), c = progCounts(p);
  const sel = progWeekSel[id] || Math.min(Math.max(1, w), weeks);
  const tp = todayPlan(p);
  const pick = tp.state === "on" ? (tp.missed[0] || tp.today[0] || null) : null;
  let h = topBar(p.name, "#home", w < 1 ? `Starts ${fmtDate(progStart(p))}` : w > weeks ? "Finished" : `Week ${w} of ${weeks}${weekLabel(p, w) ? " · " + weekLabel(p, w) : ""}`) + `<div class="stack">`;
  h += `<div class="stats">
    <div class="stat"><div class="eyebrow">Week</div><div class="v">${Math.max(0, Math.min(w, weeks))}<small> of ${weeks}</small></div></div>
    <div class="stat"><div class="eyebrow">Review</div><div class="v">${rv.days}<small> days</small></div><div class="tiny muted">${fmtDate(rv.date)}</div></div>
    <div class="stat"><div class="eyebrow">Done so far</div><div class="v">${c.done}<small> of ${c.planned}</small></div></div></div>`;
  h += pick ? `<a class="btn primary wide" href="${sessRoute(p, pick.sess, pick.week)}">Today's session: ${esc(pick.sess.name)}${pick.st === "missed" ? " (catch up)" : ""}</a>`
    : `<div class="notice">${tp.state === "on" ? (tp.next ? `Rest day. Next up: <b>${esc(tp.next.sess.name)}</b> on ${fmtDate(tp.next.date)}.` : "All done for this week.") : tp.state === "before" ? `Starts ${fmtDate(progStart(p))}.` : "Programme finished: time for the review."}</div>`;
  h += `<section class="stack tight"><div class="row between"><h2>Sessions</h2></div><div class="chips" role="group" aria-label="Week">${Array.from({ length: weeks }, (_, i) => `<button class="chip" data-w="${i + 1}" aria-pressed="${sel === i + 1}">Week ${i + 1}${i + 1 === w ? " ·  now" : ""}</button>`).join("")}</div>`;
  if (weekLabel(p, sel)) h += `<p class="small muted">${esc(weekLabel(p, sel))}</p>`;
  h += `<div class="list">`;
  const sch = schedule(p, sel);
  sch.forEach(i => h += sessCard(p, i, statusOf({ ...i, p }), true));
  (p.sessions || []).filter(s => !(s.days || []).length).forEach(s => h += sessCard(p, { sess: s, week: sel, date: 0 }, doneLog(p, s.key, sel) ? "done" : "any", true));
  h += `</div></section>`;
  h += `<div class="row"><a class="btn" href="#pprog-${esc(p.id)}">Programme progress</a><a class="btn" href="#edit-${esc(p.id)}">Edit programme</a></div>`;
  if (p.notes) h += `<details><summary>About this programme</summary><p class="small muted" style="margin-top:6px;white-space:pre-wrap">${esc(p.notes)}</p></details>`;
  h += `</div>`;
  app.innerHTML = h;
  $$("[data-w]").forEach(b => b.onclick = () => { progWeekSel[id] = +b.dataset.w; render(); });
}

/* ---------------- SESSION PREVIEW (+ Start) ---------------- */
function lastFor(name, excludeId) {
  for (const l of S.logs) { if (l.id === excludeId || l.status === "active") continue; const sets = (l.sets || []).filter(s => s.exName === name); if (sets.length) return { log: l, sets }; }
  return null;
}
function renderSessPreview(app, arg) {
  if (arg === "free") {
    app.innerHTML = topBar("Free session", "#home") + `<div class="stack"><p class="muted">A session that isn't part of a programme. Add exercises as you go.</p><button class="primary wide" id="go">Start free session</button><button class="wide" id="goRow">Log a row by hand</button></div>`;
    $("#go").onclick = () => startStrength(null, null, null); $("#goRow").onclick = () => location.hash = "rowform-free"; return;
  }
  const [pid, key, wk] = arg.split("~"); const p = S.progs.find(x => x.id === pid); const s = p && (p.sessions || []).find(x => x.key === key);
  if (!s) { location.hash = "home"; return; }
  const week = +wk || 1, wd = weekDef(s, week); const it = schedule(p, week).find(i => i.sess.key === key);
  const done = doneLog(p, key, week);
  let h = topBar(s.name, "#prog-" + p.id, `${p.name} · Week ${week}${it ? " · " + fmtDate(it.date) : ""}`) + `<div class="stack">`;
  if (s.focus) h += `<p class="muted">${esc(s.focus)}</p>`;
  if (done) h += `<a class="notice" href="#log-${esc(done.id)}" style="text-decoration:none;color:inherit">Done on ${fmtDate(done.startedAt)}. <b>See the session →</b></a>`;
  if (wd.notes) h += `<div class="notice">${esc(wd.notes)}</div>`;
  if (s.kind === "row") {
    h += `<div class="card"><div class="tablewrap"><table><thead><tr><th>Part</th><th>Time</th><th>Heart rate</th><th>Rate</th></tr></thead><tbody>${(wd.parts || []).map(x => `<tr><td><b>${esc(x.part)}</b></td><td>${esc(x.time)}</td><td>${esc(x.hr)}</td><td>${esc(x.rate)}</td></tr>`).join("")}</tbody></table></div></div>`;
    h += `<p class="small muted">Row on the machine with Ergzone running, then bring the result in: import the Ergzone file (ask Claude to "sync my rows"), or type it in.</p>`;
    h += `<div class="sticky-foot stack tight"><a class="btn primary wide" href="#rowform-${esc(p.id)}~${esc(key)}~${week}">Log this row by hand</a><a class="btn wide" href="#import">Import Ergzone file</a></div>`;
  } else {
    h += `<div class="list">${(s.exercises || []).map(ex => {
      const t = { ...(wd.ex || {})[ex.id] }; const prev = lastFor(ex.name);
      return `<div class="card stack tight"><div class="row between nowrap"><h3>${esc(ex.name)}</h3><span class="target">${esc(targetText(ex, t))}</span></div>${ex.note || t.note ? `<p class="small muted">${esc([ex.note, t.note].filter(Boolean).join(" "))}</p>` : ""}${prev ? `<p class="small">Last time: ${prev.sets.map(setText).map(esc).join(", ")}</p>` : ""}</div>`;
    }).join("")}</div>`;
    const live = activeLog();
    h += `<div class="sticky-foot">${live ? `<a class="btn wide" href="#live">Finish "${esc(live.name)}" first</a>` : `<button class="primary wide" id="start">Start session</button>`}</div>`;
  }
  h += `</div>`;
  app.innerHTML = h;
  const st = $("#start"); if (st) st.onclick = () => startStrength(p, s, week);
}
function startStrength(p, s, week) {
  if (activeLog()) { location.hash = "live"; return; }
  let exercises = [], notes = "";
  if (s) {
    const wd = weekDef(s, week); notes = wd.notes || "";
    exercises = (s.exercises || []).map(ex => { const t = (wd.ex || {})[ex.id] || {}; return { id: ex.id, name: ex.name, measure: ex.measure || "reps", note: [ex.note, t.note].filter(Boolean).join(" "), sets: t.sets || 3, reps: t.reps || 10, repsFrom: t.repsFrom || 0, weight: t.weight || 0, rest: t.rest || 90 }; });
  }
  const log = { id: uid(), kind: "strength", status: "active", programmeId: p ? p.id : "", planName: p ? p.name : "", sessionKey: s ? s.key : "", week: week || 0, name: s ? s.name : "Free session", startedAt: Date.now(), endedAt: 0, exercises, sets: [], hr: [], hrT0: 0, notes: "", sessionNotes: notes };
  saveLog(log); location.hash = "live"; requestWake();
}
let wake = null;
async function requestWake() { try { if ("wakeLock" in navigator) wake = await navigator.wakeLock.request("screen"); } catch { } }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.loaded && activeLog()) requestWake(); });

/* ---------------- LIVE LOGGER ---------------- */
const draft = {};
function renderLive(app) {
  const log = activeLog(); if (!log) { location.hash = "home"; return; }
  const sets = log.sets || []; const lastSet = sets.length ? sets.reduce((a, b) => a.t > b.t ? a : b) : null;
  let h = topBar(log.name, "#home", `${log.planName ? log.planName + " · " : ""}${log.week ? "Week " + log.week + " · " : ""}started ${fmtTime(log.startedAt)}`) + `<div class="stack">`;
  h += `<div class="row between"><span class="small muted">Elapsed</span><span class="pill live num" id="elapsed">0:00</span></div>`;
  if (log.sessionNotes) h += `<details class="notice" style="border:0;padding:10px 12px"><summary style="min-height:0;color:inherit">Warm-up and notes</summary><p class="small" style="margin-top:6px">${esc(log.sessionNotes)}</p></details>`;
  if (lastSet) { const ex = (log.exercises || []).find(e => e.id === lastSet.exId); const rest = ex && ex.rest ? ex.rest : 0;
    h += `<div class="restbar" id="restbar" data-t="${lastSet.t}" data-rest="${rest}"><div><div class="small">Rest${rest ? ` · target ${fmtDur(rest)}` : ""}</div><div class="clock" id="restclock">0:00</div></div><div class="small" style="text-align:right">Last: ${esc(lastSet.exName)}<br>${esc(setText(lastSet))}</div></div>`; }
  (log.exercises || []).forEach(ex => {
    const mine = sets.filter(s => s.exId === ex.id), prev = lastFor(ex.name, log.id);
    const d = draft[ex.id] || { w: mine.length ? mine[mine.length - 1].weight : (prev ? prev.sets[prev.sets.length - 1].weight : ex.weight || 0), r: mine.length ? mine[mine.length - 1].reps : ex.reps || 0 };
    draft[ex.id] = d; const done = ex.sets && mine.length >= ex.sets; const tm = isTimed(ex);
    h += `<div class="card ex" id="ex-${esc(ex.id)}">
      <div class="ex-head"><div class="grow"><h3>${esc(ex.name)}</h3><div class="target">${esc(targetText(ex))}</div>${ex.note ? `<div class="small muted">${esc(ex.note)}</div>` : ""}${prev ? `<div class="small">Last time: ${prev.sets.map(setText).map(esc).join(", ")}</div>` : ""}</div>${done ? `<span class="pill good">Done</span>` : `<span class="pill num">${mine.length}/${ex.sets || "–"}</span>`}</div>
      ${mine.length ? `<div>${mine.map((s, i) => `<div class="setline"><span class="n">${i + 1}</span><span class="num">${esc(setText(s))}</span><span class="when">${fmtTime(s.t)}</span><button class="ghost danger" data-del="${esc(s.id)}" aria-label="Delete set ${i + 1}">Delete</button></div>`).join("")}</div>` : ""}
      <div class="entry">
        <label class="f">Weight (kg)${tm ? ", optional" : ""}<div class="step"><button data-adj="${esc(ex.id)}|w|-2.5" aria-label="Less weight">−</button><input id="w-${esc(ex.id)}" inputmode="decimal" value="${d.w || 0}" aria-label="Weight in kg"><button data-adj="${esc(ex.id)}|w|2.5" aria-label="More weight">+</button></div></label>
        <label class="f">${tm ? "Seconds" : "Reps"}<div class="step"><button data-adj="${esc(ex.id)}|r|${tm ? -5 : -1}" aria-label="Fewer">−</button><input id="r-${esc(ex.id)}" inputmode="numeric" value="${d.r || 0}" aria-label="${tm ? "Seconds" : "Reps"}"><button data-adj="${esc(ex.id)}|r|${tm ? 5 : 1}" aria-label="More">+</button></div></label>
        <button class="primary go" data-log="${esc(ex.id)}">Log set ${mine.length + 1}</button>
      </div></div>`;
  });
  h += `<details class="card" style="border-top:1px solid var(--line)"><summary>Add an exercise</summary><div class="stack" style="margin-top:10px">
    <label class="f">Exercise name<input id="nxName" placeholder="e.g. Farmer's carry"></label>
    <div class="row nowrap"><label class="f grow">Sets<input id="nxSets" inputmode="numeric" value="3"></label><label class="f grow">Reps<input id="nxReps" inputmode="numeric" value="10"></label><label class="f grow">kg<input id="nxW" inputmode="decimal" value="0"></label></div>
    <button id="nxGo">Add to this session</button></div></details>`;
  h += `<label class="f">Notes<textarea id="logNotes" style="font-family:var(--body);font-size:14px;min-height:70px" placeholder="How it felt, niggles, swaps">${esc(log.notes || "")}</textarea></label>`;
  h += `<button class="pulse wide" id="finish">Finish session</button><p class="small muted">After finishing, end the workout on your watch too, then add the heart rate.</p><button class="ghost danger" id="discard">Discard this session</button></div>`;
  app.innerHTML = h;
  $$("[data-adj]").forEach(b => b.onclick = () => { const [id, k, delta] = b.dataset.adj.split("|"); const inp = $(`#${k}-${CSS.escape(id)}`); let v = parseFloat(inp.value) || 0; v = Math.max(0, Math.round((v + parseFloat(delta)) * 100) / 100); inp.value = v; draft[id][k] = v; });
  $$(".step input").forEach(inp => inp.oninput = () => { const k = inp.id[0], id = inp.id.slice(2); draft[id][k] = parseFloat(inp.value) || 0; });
  $$("[data-log]").forEach(b => b.onclick = () => {
    const ex = log.exercises.find(e => e.id === b.dataset.log);
    const w = parseFloat($(`#w-${CSS.escape(ex.id)}`).value) || 0, r = parseFloat($(`#r-${CSS.escape(ex.id)}`).value) || 0;
    if (r <= 0) return toast(isTimed(ex) ? "Enter the seconds first." : "Enter the reps first.");
    log.sets.push({ id: uid(), exId: ex.id, exName: ex.name, measure: ex.measure || "reps", weight: w, reps: r, t: Date.now() });
    saveLog(log); toast("Set logged"); render();
  });
  $$("[data-del]").forEach(b => confirmBtn(b, "Sure?", () => { log.sets = log.sets.filter(s => s.id !== b.dataset.del); saveLog(log); render(); }));
  $("#nxGo").onclick = () => { const name = $("#nxName").value.trim(); if (!name) return toast("Give the exercise a name.");
    log.exercises.push({ id: uid(), name, sets: parseInt($("#nxSets").value) || 3, reps: parseInt($("#nxReps").value) || 10, weight: parseFloat($("#nxW").value) || 0, rest: 90, measure: "reps" }); saveLog(log); render(); };
  let nt; $("#logNotes").oninput = e => { clearTimeout(nt); nt = setTimeout(() => { log.notes = e.target.value; saveLog(log); }, 800); };
  $("#finish").onclick = () => { log.notes = $("#logNotes").value; log.status = "done"; log.endedAt = Date.now(); saveLog(log); try { wake && wake.release(); } catch { } location.hash = "log-" + log.id; };
  confirmBtn($("#discard"), "Tap again to discard", () => { deleteLog(log.id); location.hash = "home"; });
  const tick = () => { const el = $("#elapsed"); if (el) el.textContent = fmtDur((Date.now() - log.startedAt) / 1000); const rb = $("#restbar"); if (!rb) return; const s = (Date.now() - Number(rb.dataset.t)) / 1000, rest = Number(rb.dataset.rest); $("#restclock").textContent = fmtDur(s); rb.classList.toggle("over", rest > 0 && s > rest); };
  tick(); restTick = setInterval(tick, 1000);
}

/* ---------------- ROW FORM ---------------- */
function renderRowForm(app, arg) {
  let p = null, s = null, week = 0, date = Date.now();
  if (arg !== "free") { const [pid, key, wk] = arg.split("~"); p = S.progs.find(x => x.id === pid); s = p && (p.sessions || []).find(x => x.key === key); week = +wk || 0;
    const it = p && schedule(p, week).find(i => i.sess.key === key); if (it && it.date <= Date.now()) date = it.date + (Date.now() - dayStart(Date.now())); }
  const wd = s ? weekDef(s, week) : null; const mins = wd && wd.minutes ? wd.minutes : 25;
  const d0 = new Date(date);
  app.innerHTML = topBar(s ? s.name : "Log a row", s ? sessRoute(p, s, week) : "#home", s ? `${p.name} · Week ${week}` : "Not in a programme") + `<form class="stack" id="rf">
    <div class="row nowrap"><label class="f grow">Date<input type="date" id="rfDate" value="${dayKey(date)}"></label><label class="f grow">Start time<input type="time" id="rfTime" value="${String(d0.getHours()).padStart(2, "0")}:${String(d0.getMinutes()).padStart(2, "0")}"></label></div>
    <div class="row nowrap"><label class="f grow">Minutes<input id="rfMin" inputmode="numeric" value="${mins}"></label><label class="f grow">Seconds<input id="rfSec" inputmode="numeric" value="0"></label><label class="f grow">Distance (m)<input id="rfDist" inputmode="numeric" placeholder="e.g. 2230"></label></div>
    <div class="row nowrap"><label class="f grow">Avg stroke rate<input id="rfSpm" inputmode="numeric" placeholder="spm"></label><label class="f grow">Avg HR<input id="rfHr" inputmode="numeric" placeholder="bpm"></label><label class="f grow">Max HR<input id="rfMax" inputmode="numeric" placeholder="bpm"></label></div>
    <label class="f">Notes<textarea id="rfNotes" style="font-family:var(--body);font-size:14px;min-height:60px"></textarea></label>
    <button class="primary wide" type="submit">Save row</button>
    <p class="small muted">You can add the full heart rate afterwards from your watch, on the row's page.</p></form>`;
  $("#rf").onsubmit = e => {
    e.preventDefault();
    const [y, m, d] = $("#rfDate").value.split("-").map(Number), [hh, mm] = ($("#rfTime").value || "12:00").split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm).getTime(), secs = (parseInt($("#rfMin").value) || 0) * 60 + (parseInt($("#rfSec").value) || 0);
    if (!secs) return toast("Enter how long you rowed.");
    const log = { id: uid(), kind: "row", status: "done", programmeId: p ? p.id : "", planName: p ? p.name : "", sessionKey: s ? s.key : "", week, name: s ? s.name : "Row", startedAt: start, endedAt: start + secs * 1000, sets: [], exercises: [], hr: [], hrT0: 0, notes: $("#rfNotes").value,
      row: { source: "manual", distance: parseFloat($("#rfDist").value) || 0, seconds: secs, avgSpm: parseFloat($("#rfSpm").value) || 0, avgHr: parseFloat($("#rfHr").value) || 0, maxHr: parseFloat($("#rfMax").value) || 0 } };
    saveLog(log); toast("Row saved"); location.hash = "log-" + log.id;
  };
}

/* ---------------- IMPORT ---------------- */
function matchRow(r) {
  const day = dayStart(r.startedAt);
  for (const p of S.progs) {
    const w = progWeek(p, r.startedAt); if (w < 1 || w > (p.weeks || 4)) continue;
    const sch = schedule(p, w).filter(i => i.sess.kind === "row");
    const same = sch.find(i => i.date === day && !doneLog(p, i.sess.key, w));
    if (same) return { p, s: same.sess, w };
    const open = sch.find(i => !doneLog(p, i.sess.key, w) && i.date <= day + DAY);
    if (open) return { p, s: open.sess, w };
  }
  return null;
}
function importData(obj) {
  const out = { rows: [], progs: [], skipped: 0 };
  if (!obj || obj.format !== "setpulse-import") throw new Error("This isn't a Set & Pulse file.");
  (obj.programmes || []).forEach(pr => { if (!pr.id || !pr.sessions) return; saveProg(pr); out.progs.push(pr); });
  (obj.rows || []).sort((a, b) => a.startedAt - b.startedAt).forEach(r => {
    const id = "erg-" + (r.extId || uid());
    if (S.logs.find(l => l.id === id)) { out.skipped++; return; }
    const m = matchRow(r);
    const log = { id, kind: "row", status: "done", programmeId: m ? m.p.id : "", planName: m ? m.p.name : "", sessionKey: m ? m.s.key : "", week: m ? m.w : 0, name: m ? m.s.name : (r.title || "Row"), startedAt: r.startedAt, endedAt: r.startedAt + r.seconds * 1000, sets: [], exercises: [], hrT0: r.startedAt, hr: r.hr || [], notes: "",
      row: { source: r.source || "Ergzone", extId: r.extId, title: r.title, distance: r.distance, seconds: r.seconds, avgSpm: r.avgSpm, avgHr: r.avgHr, maxHr: r.maxHr, calories: r.calories, spm: r.spm || [], dist: r.dist || [] } };
    saveLog(log); out.rows.push(log);
  });
  return out;
}
function renderImport(app) {
  app.innerHTML = topBar("Import a file", "#home") + `<div class="stack">
    <p class="muted">For rowing sessions from Ergzone, or a programme someone made for you. Ask Claude to "sync my rows" and it will give you a file to bring in here.</p>
    <label class="btn primary wide">Choose file<input type="file" id="impFile" accept=".json,application/json,text/plain" hidden></label>
    <details><summary>Or paste the file's contents</summary><div class="stack" style="margin-top:8px"><textarea id="impText" placeholder='{"format":"setpulse-import", ...}'></textarea><button id="impGo">Import</button></div></details>
    <div id="impOut"></div></div>`;
  const run = text => {
    try {
      const r = importData(JSON.parse(text));
      $("#impOut").innerHTML = `<div class="card stack"><h3>Imported</h3>${r.progs.map(p => `<a href="#prog-${esc(p.id)}">Programme: ${esc(p.name)}</a>`).join("")}${r.rows.map(l => `<a href="#log-${esc(l.id)}">${esc(l.name)} · ${fmtDate(l.startedAt)}${l.week ? " · Week " + l.week : " · not matched to a programme"}</a>`).join("")}${r.skipped ? `<p class="small muted">${plural(r.skipped, "row")} already in your log, skipped.</p>` : ""}${!r.rows.length && !r.progs.length && !r.skipped ? "<p>Nothing to import in that file.</p>" : ""}</div>`;
    } catch (e) { $("#impOut").innerHTML = `<div class="notice warn">${esc(e.message.startsWith("Unexpected") ? "That file couldn't be read. Make sure it's the whole file from Claude." : e.message)}</div>`; }
  };
  $("#impFile").onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => run(String(rd.result)); rd.readAsText(f); };
  $("#impGo").onclick = () => run($("#impText").value);
}

/* ---------------- LOG DETAIL ---------------- */
function sessFor(log) { const p = S.progs.find(x => x.id === log.programmeId); const s = p && (p.sessions || []).find(x => x.key === log.sessionKey); return { p, s }; }
function renderLog(app, id) {
  const log = S.logs.find(l => l.id === id);
  if (!log) { app.innerHTML = topBar("Session", "#history") + `<div class="card empty">That session isn't in your log.</div>`; return; }
  if (log.status === "active") { location.hash = "live"; return; }
  const { p, s } = sessFor(log); const target = s && s.targetHr;
  const end = log.endedAt || (log.sets || []).reduce((a, x) => Math.max(a, x.t), log.startedAt);
  const st = hrStats(log, target), row = log.row;
  let h = topBar(log.name, "#history", `${log.planName ? log.planName + " · " : ""}${log.week ? "Week " + log.week + " · " : ""}${fmtDate(log.startedAt)}, ${fmtTime(log.startedAt)}`) + `<div class="stack">`;
  if (row) {
    h += `<div class="stats">
      <div class="stat"><div class="eyebrow">Time</div><div class="v num">${fmtDur(row.seconds)}</div></div>
      <div class="stat"><div class="eyebrow">Distance</div><div class="v">${fmtNum(row.distance)}<small> m</small></div></div>
      <div class="stat"><div class="eyebrow">Avg rate</div><div class="v">${fmtNum(row.avgSpm)}<small> spm</small></div></div>
      <div class="stat"><div class="eyebrow">Avg HR</div><div class="v" style="color:var(--pulse)">${fmtNum(st ? st.avg : row.avgHr)}<small> bpm</small></div></div>
      <div class="stat"><div class="eyebrow">Max HR</div><div class="v">${fmtNum(st ? st.peak : row.maxHr)}<small> bpm</small></div></div>
      ${st && st.inTarget != null ? `<div class="stat"><div class="eyebrow">In target</div><div class="v">${fmtNum(st.inTarget * 100)}<small>%</small></div><div class="tiny muted">${target[0]}–${target[1]} bpm</div></div>` : ""}
      ${st ? `<div class="stat"><div class="eyebrow">Effort</div><div class="v">${fmtNum(st.trimp)}<small> pts</small></div></div>` : ""}</div>`;
    if (row.distance && row.seconds) h += `<p class="small muted">Average split ${pace500(row.seconds, row.distance)} /500 m${row.source ? ` · from ${esc(row.source === "manual" ? "typed in" : row.source)}` : ""}. The Merach's distance and watts may read inaccurately, so go by heart rate and effort.</p>`;
  } else {
    h += `<div class="stats">
      <div class="stat"><div class="eyebrow">Duration</div><div class="v num">${fmtDur((end - log.startedAt) / 1000)}</div></div>
      <div class="stat"><div class="eyebrow">Sets</div><div class="v">${(log.sets || []).length}</div></div>
      <div class="stat"><div class="eyebrow">Volume</div><div class="v">${fmtNum(logVolume(log))}<small> kg</small></div></div>
      ${st ? `<div class="stat"><div class="eyebrow">Avg HR</div><div class="v" style="color:var(--pulse)">${fmtNum(st.avg)}<small> bpm</small></div></div><div class="stat"><div class="eyebrow">Peak HR</div><div class="v">${fmtNum(st.peak)}<small> bpm</small></div></div><div class="stat"><div class="eyebrow">Effort</div><div class="v">${fmtNum(st.trimp)}<small> pts</small></div></div>` : ""}</div>`;
  }
  if (st) {
    h += `<section class="card stack"><div class="row between"><h3>Heart rate</h3><span class="pill hr">${hrSeries(log).length} readings</span></div><div class="chart" id="hrChart"></div>
      <p class="small muted">${row ? (target ? `The band shows your target, ${target[0]}–${target[1]} bpm.` : "") : "Shaded bands mark each set you logged."} Tap the chart for details.</p></section>`;
    if (row && row.spm && row.spm.length > 4) h += `<section class="card stack"><h3>Stroke rate</h3><div class="chart" id="spmChart"></div></section>`;
    h += `<section class="card stack"><div class="row between"><h3>Time in zones</h3><span class="small muted">max HR ${maxHr()}${S.me.settings && S.me.settings.maxHr ? "" : " (default)"}</span></div><div class="zones">
      ${ZONES.map((z, k) => `<div class="zone"><span>${z[2]} <span class="muted small">${Math.round(z[0] * maxHr())}${k < 4 ? "–" + Math.round(z[1] * maxHr()) : "+"}</span></span><div class="zb"><i style="width:${Math.min(100, st.zmin[k] / Math.max(.01, st.minutes) * 100)}%"></i></div><span class="num small" style="text-align:right">${fmtNum(st.zmin[k], 1)} min</span></div>`).join("")}</div>
      ${S.me.settings && S.me.settings.maxHr ? "" : `<p class="small muted">Zones use a default max heart rate of ${DEFAULT_MAX}. Set yours under Me.</p>`}
      <p class="small muted">Effort points = minutes in each zone × the zone number, added up. Higher means a harder session for your heart.</p></section>`;
  }
  const eff = setEffort(log);
  if (eff.length) {
    const counts = {};
    h += `<section class="card stack"><h3>Sets</h3><div class="tablewrap"><table><thead><tr><th>Exercise</th><th class="c">Set</th><th class="r">Load</th>${st ? `<th class="r">Peak</th><th class="r">Drop 60s</th>` : ""}</tr></thead><tbody>${eff.map(({ s: x, peak, drop }) => { counts[x.exId] = (counts[x.exId] || 0) + 1; return `<tr><td>${esc(x.exName)}</td><td class="c">${counts[x.exId]}</td><td class="r">${esc(setText(x))}</td>${st ? `<td class="r">${peak ?? "–"}</td><td class="r">${drop != null ? "−" + drop : "–"}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>
      ${st ? `<p class="small muted">Peak is your highest heart rate during the set. Drop 60s is how far it fell a minute later: a bigger drop means quicker recovery.</p>` : ""}</section>`;
  }
  // re-assign to a programme session
  const opts = []; S.progs.forEach(pp => { const w = progWeek(pp, log.startedAt); if (w >= 1 && w <= (pp.weeks || 4)) (pp.sessions || []).filter(x => x.kind === (log.kind === "row" ? "row" : "strength")).forEach(x => opts.push({ v: `${pp.id}~${x.key}~${w}`, t: `${pp.name}: ${x.name}, week ${w}` })); });
  if (opts.length) h += `<label class="f">Counts as<select id="assign"><option value="">Not part of a programme</option>${opts.map(o => `<option value="${esc(o.v)}" ${o.v === `${log.programmeId}~${log.sessionKey}~${log.week}` ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select></label>`;
  if (!st || log.kind !== "row" || !row || row.source === "manual") h += hrImportCard(log, end, !!st);
  h += `<label class="f">Notes<textarea id="lnotes" style="font-family:var(--body);font-size:14px;min-height:60px">${esc(log.notes || "")}</textarea></label>`;
  h += `<button class="ghost danger" id="delLog">Delete this session</button></div>`;
  app.innerHTML = h;
  if (st) drawHrChart($("#hrChart"), log, row ? target : null);
  if ($("#spmChart")) { const sp = []; for (let i = 0; i + 1 < row.spm.length; i += 2) if (row.spm[i + 1] >= 10) sp.push({ x: log.startedAt + row.spm[i] * 1000, v: row.spm[i + 1] }); drawSeries($("#spmChart"), sp, { unit: "spm" }); }
  const a = $("#assign"); if (a) a.onchange = () => { const v = a.value; if (!v) { log.programmeId = ""; log.sessionKey = ""; log.week = 0; log.planName = ""; } else { const [pid, key, w] = v.split("~"); const pp = S.progs.find(x => x.id === pid); const ss = pp.sessions.find(x => x.key === key); log.programmeId = pid; log.sessionKey = key; log.week = +w; log.planName = pp.name; log.name = ss.name; } saveLog(log); toast("Updated"); render(); };
  let nt; $("#lnotes").oninput = e => { clearTimeout(nt); nt = setTimeout(() => { log.notes = e.target.value; saveLog(log); }, 800); };
  bindHrImport(log, end);
  confirmBtn($("#delLog"), "Tap again to delete for good", () => { deleteLog(log.id); location.hash = "history"; });
}
function hrImportCard(log, end, has) {
  return `<section class="card stack"><div class="row between"><h3>${has ? "Replace heart rate" : "Add heart rate"}</h3>${has ? "" : `<span class="pill warn">Missing</span>`}</div>
    <p class="small muted">End the workout on your watch first. Then tap <b>1. Get heart rate</b>, wait for the "ready" message, come back here and tap <b>2. Paste heart rate</b>. Only readings from ${fmtTime(log.startedAt - 120000)} to ${fmtTime(end + 120000)} are kept.</p>
    <div class="stack tight"><a class="btn primary wide" id="hrRun" href="shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName())}">1. Get heart rate</a><button class="pulse wide" id="hrClip">2. Paste heart rate</button></div>
    <details><summary>Paste or choose a file by hand</summary><div class="stack" style="margin-top:8px">
    <textarea id="hrPaste" placeholder="2026-11-24T07:49:12Z,92"></textarea>
    <div class="row"><button id="hrImport">Import heart rate</button><label class="btn">Choose a file<input type="file" id="hrFile" accept=".txt,.csv,text/plain" hidden></label></div></div></details>
    <p class="small" id="hrMsg"></p>${shortcutHelp()}</section>`;
}
function bindHrImport(log, end) {
  const b = $("#hrImport"); if (!b) return;
  const go = text => {
    const res = parseHr(text, log.startedAt - 120000, end + 120000), msg = $("#hrMsg");
    if (!res.total) { msg.textContent = "No heart rate readings found. Each line needs a date and time, then the bpm."; msg.style.color = "var(--pulse)"; return; }
    if (!res.kept.length) { msg.textContent = `Found ${res.total} readings, but none from this session's time. Run the shortcut again soon after the session.`; msg.style.color = "var(--pulse)"; return; }
    const t0 = res.kept[0][0], flat = []; res.kept.forEach(([t, bpm]) => flat.push(Math.round((t - t0) / 1000), Math.round(bpm)));
    log.hrT0 = t0; log.hr = flat; saveLog(log); toast(`${res.kept.length} heart rate readings added`); render();
  };
  b.onclick = () => go($("#hrPaste").value);
  $("#hrClip").onclick = async () => {
    try { const text = await navigator.clipboard.readText(); if (!text.trim()) throw new Error("empty"); go(text); }
    catch (e) { const msg = $("#hrMsg"); msg.style.color = "var(--pulse)"; msg.textContent = e.message === "empty" ? "The clipboard is empty. Run the shortcut first." : "This phone didn't allow reading the clipboard. Open \"Paste or choose a file by hand\", press and hold in the box, and tap Paste."; }
  };
  $("#hrFile").onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => go(String(rd.result)); rd.readAsText(f); };
}
function shortcutName() { return (S.me && S.me.settings && S.me.settings.shortcutName) || "Workout HR"; }
function shortcutHelp() {
  return `<details><summary>Set up the heart rate shortcut</summary><div class="stack small" style="margin-top:8px">
  <ol class="steps">
    <li>In <b>Shortcuts</b>, tap <b>+</b> and name it <code>Workout HR</code>.</li>
    <li><b>Find Health Samples</b>: Type is Heart Rate, Start Date is in the last 1 day. Sort by Start Date, Order <b>Latest First</b>, Limit <b>on, 750</b> (enough for an hour).</li>
    <li><b>Text</b>: insert <i>Health Samples</i>, tap it, choose <b>Start Date</b>, format <b>ISO 8601</b> with time. New line, type <code>---</code>, new line, insert <i>Health Samples</i> again and choose <b>Value</b>.</li>
    <li><b>Copy to Clipboard</b>. No Repeat needed, so it runs in seconds.</li>
    <li><b>Show Alert</b>: "Heart rate ready. Go back to Set &amp; Pulse and tap Paste heart rate." Turn off Show Cancel Button.</li>
    <li>First run: allow Health access. If it says it can't share that many items, turn on Settings → Apps → Shortcuts → Advanced → Allow Sharing Large Amounts of Data.</li>
  </ol><p>You get all the times, a line with <code>---</code>, then all the heart rates. The older one-line-per-reading format (<code>2026-11-24T21:26:41Z,93</code>) works too.</p></div></details>`;
}

/* ---------------- charts ---------------- */
function frame(el, H) { return { W: Math.max(280, el.clientWidth || 320), H, m: { l: 36, r: 10, t: 10, b: 24 } }; }
function ticks(min, max, n = 4) { const span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw); const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6)); return out; }
function hover(el, svg, pts, fmt) {
  const tip = document.createElement("div"); tip.className = "tip"; el.appendChild(tip);
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".hdot");
  const move = ev => { const r = svg.getBoundingClientRect(), sx = r.width / svg.viewBox.baseVal.width, x = (ev.clientX - r.left) / sx; let best = null, bd = Infinity; for (const p of pts) { const d = Math.abs(p.px - x); if (d < bd) { bd = d; best = p; } } if (!best) return;
    cross.setAttribute("x1", best.px); cross.setAttribute("x2", best.px); cross.style.opacity = 1; if (dot) { dot.setAttribute("cx", best.px); dot.setAttribute("cy", best.py); dot.style.opacity = 1; }
    tip.textContent = fmt(best); tip.classList.add("on"); tip.style.left = Math.min(r.width - 60, Math.max(60, best.px * sx)) + "px"; tip.style.top = (best.py * sx) + "px"; };
  const out = () => { tip.classList.remove("on"); cross.style.opacity = 0; if (dot) dot.style.opacity = 0; };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", out);
}
function timeAxis(X, t0, t1, H) { const mins = (t1 - t0) / 60000, st = mins > 90 ? 20 : mins > 40 ? 10 : 5; let s = ""; for (let k = 0; k <= mins; k += st) s += `<text x="${X(t0 + k * 60000).toFixed(1)}" y="${H - 6}" text-anchor="middle">${k}m</text>`; return s; }
function drawHrChart(el, log, band) {
  const hr = hrSeries(log); if (hr.length < 2) return;
  const { W, H, m } = frame(el, 220), t0 = hr[0][0], t1 = hr[hr.length - 1][0];
  let lo = Math.min(...hr.map(h => h[1])), hi = Math.max(...hr.map(h => h[1])); if (band) { lo = Math.min(lo, band[0]); hi = Math.max(hi, band[1]); }
  const yt = ticks(Math.floor((lo - 5) / 10) * 10, Math.ceil((hi + 5) / 10) * 10), y0 = yt[0], y1 = yt[yt.length - 1];
  const X = t => m.l + (t - t0) / (t1 - t0 || 1) * (W - m.l - m.r), Y = b => m.t + (1 - (b - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const pts = hr.map(([t, b]) => ({ px: X(t), py: Y(b), t, b }));
  const line = pts.map((p, i) => (i ? "L" : "M") + p.px.toFixed(1) + "," + p.py.toFixed(1)).join("");
  const sets = [...(log.sets || [])].sort((a, b) => a.t - b.t).filter(s => s.t >= t0 - 60000 && s.t <= t1 + 60000);
  const bands = sets.map(s => { const a = X(Math.max(t0, s.t - 45000)), b = X(Math.min(t1, s.t)); return `<rect x="${a.toFixed(1)}" y="${m.t}" width="${Math.max(2, b - a).toFixed(1)}" height="${H - m.t - m.b}" fill="var(--accent)" opacity=".14" rx="2"></rect>`; }).join("");
  const tb = band ? `<rect x="${m.l}" y="${Y(band[1]).toFixed(1)}" width="${W - m.l - m.r}" height="${(Y(band[0]) - Y(band[1])).toFixed(1)}" fill="var(--good)" opacity=".13"/>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Heart rate from ${Math.round(lo)} to ${Math.round(hi)} bpm"><g class="grid">${yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>${yt.map(v => `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
    ${tb}${bands}<path d="${line}L${pts[pts.length - 1].px.toFixed(1)},${Y(y0)}L${pts[0].px.toFixed(1)},${Y(y0)}Z" fill="var(--pulse)" opacity=".1"/><path d="${line}" fill="none" stroke="var(--pulse)" stroke-width="2" stroke-linejoin="round"/>${timeAxis(X, t0, t1, H)}
    <line class="cross" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)" stroke-dasharray="3 3" style="opacity:0"/><circle class="hdot" r="4.5" fill="var(--pulse)" stroke="var(--surface)" stroke-width="2" style="opacity:0"/><rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
  hover(el, el.querySelector("svg"), pts, p => { const s = sets.find(s => p.t >= s.t - 45000 && p.t <= s.t + 5000); return `${Math.round(p.b)} bpm · ${fmtDur((p.t - t0) / 1000)}${s ? " · " + s.exName : ""}`; });
}
function drawSeries(el, data, { unit }) { // time series, single line
  if (data.length < 2) return; const { W, H, m } = frame(el, 150), t0 = data[0].x, t1 = data[data.length - 1].x;
  const lo = Math.min(...data.map(d => d.v)), hi = Math.max(...data.map(d => d.v)); const yt = ticks(Math.floor(lo - 2), Math.ceil(hi + 2), 3), y0 = yt[0], y1 = yt[yt.length - 1];
  const X = t => m.l + (t - t0) / (t1 - t0 || 1) * (W - m.l - m.r), Y = v => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const pts = data.map(d => ({ px: X(d.x), py: Y(d.v), d })); const line = pts.map((p, i) => (i ? "L" : "M") + p.px.toFixed(1) + "," + p.py.toFixed(1)).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="grid">${yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>${yt.map(v => `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`).join("")}<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>${timeAxis(X, t0, t1, H)}<line class="cross" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)" stroke-dasharray="3 3" style="opacity:0"/><circle class="hdot" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" style="opacity:0"/><rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
  hover(el, el.querySelector("svg"), pts, p => `${fmtNum(p.d.v)} ${unit} · ${fmtDur((p.d.x - t0) / 1000)}`);
}
function drawLine(el, data, { fmt, unit, color = "var(--accent)" }) {
  if (!data.length) { el.innerHTML = `<p class="small muted">Not enough data yet.</p>`; return; }
  if (data.length === 1) { el.innerHTML = `<p class="small muted">One session so far (${esc(data[0].label)}): <b>${esc(fmt(data[0].v))}${unit ? " " + esc(unit) : ""}</b>. The trend line appears after the next one.</p>`; return; }
  const { W, H, m } = frame(el, 170); const vals = data.map(d => d.v); let lo = Math.min(...vals), hi = Math.max(...vals); if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * .15, yt = ticks(lo - pad, hi + pad), y0 = yt[0], y1 = yt[yt.length - 1];
  const X = i => data.length === 1 ? (m.l + W - m.r) / 2 : m.l + i / (data.length - 1) * (W - m.l - m.r), Y = v => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const pts = data.map((d, i) => ({ px: X(i), py: Y(d.v), d })), line = pts.map((p, i) => (i ? "L" : "M") + p.px.toFixed(1) + "," + p.py.toFixed(1)).join(""), every = Math.ceil(data.length / 5), last = pts[pts.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="grid">${yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>${yt.map(v => `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtNum(v, 1)}</text>`).join("")}
    ${pts.map((p, i) => (i % every === 0 || i === pts.length - 1) ? `<text x="${p.px.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(p.d.label)}</text>` : "").join("")}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${pts.map(p => `<circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="3" fill="${color}"/>`).join("")}<circle cx="${last.px.toFixed(1)}" cy="${last.py.toFixed(1)}" r="5.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
    <line class="cross" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)" stroke-dasharray="3 3" style="opacity:0"/><circle class="hdot" r="5" fill="${color}" stroke="var(--surface)" stroke-width="2" style="opacity:0"/><rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
  hover(el, el.querySelector("svg"), pts, p => `${p.d.label}: ${fmt(p.d.v)}${unit ? " " + unit : ""}${p.d.note ? " · " + p.d.note : ""}`);
}
function drawBars(el, data, { fmt, unit, color = "var(--accent)" }) {
  if (!data.length) { el.innerHTML = `<p class="small muted">Not enough data yet.</p>`; return; }
  const { W, H, m } = frame(el, 160), hi = Math.max(...data.map(d => d.v), 1), yt = ticks(0, hi * 1.1), y1 = yt[yt.length - 1];
  const bw = (W - m.l - m.r) / data.length, g = Math.min(8, bw * .25), Y = v => m.t + (1 - v / y1) * (H - m.t - m.b);
  const pts = data.map((d, i) => ({ px: m.l + i * bw + bw / 2, py: Y(d.v), d })), every = Math.ceil(data.length / 5);
  const bp = (x, y, w, h) => { const r = Math.min(4, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="grid">${yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>${yt.map(v => `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`).join("")}
    ${pts.map((p, i) => { const x = m.l + i * bw + g / 2, w = Math.max(2, bw - g), h = Math.max(0, Y(0) - p.py); return h > 0 ? `<path d="${bp(x, p.py, w, h)}" fill="${color}"/>` : ""; }).join("")}
    ${pts.map((p, i) => (i % every === 0 || i === pts.length - 1) ? `<text x="${p.px.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(p.d.label)}</text>` : "").join("")}
    <line class="cross" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)" stroke-dasharray="3 3" style="opacity:0"/><rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
  hover(el, el.querySelector("svg"), pts, p => `${p.d.label}: ${fmt(p.d.v)}${unit ? " " + unit : ""}${p.d.note ? " · " + p.d.note : ""}`);
}

/* ---------------- HISTORY ---------------- */
function logCard(l) {
  const st = hrStats(l), end = l.endedAt || l.startedAt;
  const sub = l.kind === "row" && l.row ? `${fmtDur(l.row.seconds)} · ${fmtNum(l.row.distance)} m${l.row.avgSpm ? " · " + l.row.avgSpm + " spm" : ""}` : `${fmtDur((end - l.startedAt) / 1000)} · ${(l.sets || []).length} sets · ${fmtNum(logVolume(l))} kg`;
  const hrp = st ? `<span class="pill hr">♥ ${fmtNum(st.avg)}</span>` : l.row && l.row.avgHr ? `<span class="pill hr">♥ ${fmtNum(l.row.avgHr)}</span>` : `<span class="pill">No HR</span>`;
  return `<a class="card link sess" href="#log-${esc(l.id)}"><span class="kind">${ICON[l.kind] || ICON.free}</span><div class="meta grow"><div class="eyebrow">${fmtDate(l.startedAt)} · ${fmtTime(l.startedAt)}${l.planName ? " · " + esc(l.planName) : ""}</div><h3>${esc(l.name)}</h3><p class="small muted">${sub}</p></div>${hrp}</a>`;
}
function renderHistory(app) {
  const done = S.logs.filter(l => l.status === "done");
  let h = topBar("History", null, `${plural(done.length, "session")}`) + `<div class="list">`;
  if (!done.length) h += `<div class="card flat empty"><h3>No sessions yet</h3><p>Everything you finish, from any programme, shows up here.</p></div>`;
  let lastMonth = "";
  done.forEach(l => { const mo = new Date(l.startedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); if (mo !== lastMonth) { h += `<div class="eyebrow" style="margin-top:6px">${mo}</div>`; lastMonth = mo; } h += logCard(l); });
  app.innerHTML = h + `</div>`;
}

/* ---------------- PROGRESS (shared pieces) ---------------- */
let exPick = {};
function exerciseSection(scopeLogs, key) {
  const names = [...new Set(scopeLogs.flatMap(l => (l.sets || []).map(s => s.exName)))].sort();
  if (!names.length) return { html: `<section class="card stack"><h3>Strength</h3><p class="small muted">Log a strength session to see your weights and reps here.</p></section>`, bind() { } };
  if (!exPick[key] || !names.includes(exPick[key])) exPick[key] = names[0];
  const html = `<section class="card stack"><h3>Strength</h3><select id="exPick-${key}" aria-label="Exercise">${names.map(n => `<option ${n === exPick[key] ? "selected" : ""}>${esc(n)}</option>`).join("")}</select><div id="exSum-${key}"></div>
    <div><div class="eyebrow" id="exL1-${key}">Top set</div><div class="chart" id="exC1-${key}"></div></div><div><div class="eyebrow" id="exL2-${key}">Volume</div><div class="chart" id="exC2-${key}"></div></div></section>`;
  const bind = () => {
    const draw = () => {
      const n = exPick[key];
      const rows = scopeLogs.slice().reverse().map(l => { const ss = (l.sets || []).filter(s => s.exName === n); if (!ss.length) return null; const tm = ss[0].measure === "secs"; const top = ss.reduce((a, s) => (s.weight > a.weight || (s.weight === a.weight && s.reps > a.reps)) ? s : a, ss[0]);
        return { l, tm, top, best: tm ? Math.max(...ss.map(s => s.reps)) : Math.max(...ss.map(s => e1rm(s.weight, s.reps))), maxR: Math.max(...ss.map(s => s.reps)), vol: ss.reduce((a, s) => a + (tm ? 0 : s.weight * s.reps), 0), reps: ss.reduce((a, s) => a + s.reps, 0) }; }).filter(Boolean);
      const lab = r => fmtShort(r.l.startedAt) + (r.l.week ? ` W${r.l.week}` : "");
      const r0 = rows[rows.length - 1], rF = rows[0];
      $(`#exSum-${key}`).innerHTML = `<div class="stats"><div class="stat"><div class="eyebrow">Last top set</div><div class="v" style="font-size:20px">${esc(setText(r0.top))}</div></div><div class="stat"><div class="eyebrow">Sessions</div><div class="v">${rows.length}</div></div>${rows.length > 1 && rF.best > 0 ? `<div class="stat"><div class="eyebrow">Change</div><div class="v" style="font-size:20px;color:${r0.best >= rF.best ? "var(--good)" : "var(--pulse)"}">${r0.best >= rF.best ? "+" : ""}${fmtNum((r0.best / rF.best - 1) * 100)}%</div></div>` : ""}</div>`;
      if (rows[0].tm) { $(`#exL1-${key}`).textContent = "Longest hold (seconds)"; drawLine($(`#exC1-${key}`), rows.map(r => ({ label: lab(r), v: r.best })), { fmt: v => fmtNum(v), unit: "s" }); $(`#exL2-${key}`).textContent = "Total seconds per session"; drawBars($(`#exC2-${key}`), rows.map(r => ({ label: lab(r), v: r.reps })), { fmt: v => fmtNum(v), unit: "s" }); }
      else if (rows.some(r => r.best > 0)) { $(`#exL1-${key}`).textContent = "Estimated 1-rep max (kg)"; drawLine($(`#exC1-${key}`), rows.filter(r => r.best > 0).map(r => ({ label: lab(r), v: r.best, note: setText(r.top) })), { fmt: v => fmtNum(v, 1), unit: "kg" }); $(`#exL2-${key}`).textContent = "Volume per session (kg × reps)"; drawBars($(`#exC2-${key}`), rows.map(r => ({ label: lab(r), v: r.vol })), { fmt: v => fmtNum(v), unit: "kg" }); }
      else { $(`#exL1-${key}`).textContent = "Most reps in a set"; drawLine($(`#exC1-${key}`), rows.map(r => ({ label: lab(r), v: r.maxR })), { fmt: v => fmtNum(v), unit: "reps" }); $(`#exL2-${key}`).textContent = "Total reps per session"; drawBars($(`#exC2-${key}`), rows.map(r => ({ label: lab(r), v: r.reps })), { fmt: v => fmtNum(v), unit: "reps" }); }
    };
    draw(); $(`#exPick-${key}`).onchange = e => { exPick[key] = e.target.value; draw(); };
  };
  return { html, bind };
}
function heartSection(scopeLogs, key, targetFor) {
  const xs = scopeLogs.slice().reverse().map(l => ({ l, st: hrStats(l, targetFor ? targetFor(l) : null) })).filter(x => x.st);
  if (!xs.length) return { html: `<section class="card stack"><h3>Heart and effort</h3><p class="small muted">Add heart rate to a session to see this.</p></section>`, bind() { } };
  const html = `<section class="card stack"><h3>Heart and effort</h3><div><div class="eyebrow">Effort points per session</div><div class="chart" id="hE-${key}"></div></div><div><div class="eyebrow">Average heart rate (bpm)</div><div class="chart" id="hA-${key}"></div></div>
    <div><div class="eyebrow">Strength: kg moved per effort point</div><div class="chart" id="hW-${key}"></div><p class="small muted" style="margin-top:6px">If this rises, you're moving more weight for the same cost to your heart.</p></div>
    <div><div class="eyebrow">Recovery: average drop 60 s after a set (bpm)</div><div class="chart" id="hR-${key}"></div></div></section>`;
  const bind = () => {
    const lab = x => fmtShort(x.l.startedAt);
    drawBars($(`#hE-${key}`), xs.map(x => ({ label: lab(x), v: Math.round(x.st.trimp), note: x.l.name })), { fmt: v => fmtNum(v), unit: "pts", color: "var(--pulse)" });
    drawLine($(`#hA-${key}`), xs.map(x => ({ label: lab(x), v: x.st.avg, note: x.l.name })), { fmt: v => fmtNum(v), unit: "bpm", color: "var(--pulse)" });
    drawLine($(`#hW-${key}`), xs.filter(x => x.l.kind !== "row" && x.st.trimp > 0 && logVolume(x.l) > 0).map(x => ({ label: lab(x), v: logVolume(x.l) / x.st.trimp, note: x.l.name })), { fmt: v => fmtNum(v, 1), unit: "kg/pt" });
    drawLine($(`#hR-${key}`), xs.map(x => { const d = setEffort(x.l).map(e => e.drop).filter(v => v != null); return d.length ? { label: lab(x), v: d.reduce((a, b) => a + b, 0) / d.length, note: x.l.name } : null; }).filter(Boolean), { fmt: v => fmtNum(v, 1), unit: "bpm" });
  };
  return { html, bind };
}
function rowSection(scopeLogs, key, targetFor) {
  const rows = scopeLogs.filter(l => l.kind === "row" && l.row).slice().reverse();
  if (!rows.length) return { html: "", bind() { } };
  const html = `<section class="card stack"><h3>Rowing</h3><div class="tablewrap"><table><thead><tr><th>Date</th><th>Session</th><th class="r">Time</th><th class="r">Metres</th><th class="r">spm</th><th class="r">Avg HR</th><th class="r">In target</th></tr></thead><tbody>${rows.slice().reverse().map(l => { const t = targetFor(l), st = hrStats(l, t); return `<tr><td>${fmtShort(l.startedAt)}</td><td><a href="#log-${esc(l.id)}">${esc(l.name)}</a></td><td class="r">${fmtDur(l.row.seconds)}</td><td class="r">${fmtNum(l.row.distance)}</td><td class="r">${fmtNum(l.row.avgSpm)}</td><td class="r">${fmtNum(st ? st.avg : l.row.avgHr)}</td><td class="r">${st && st.inTarget != null ? fmtNum(st.inTarget * 100) + "%" : "–"}</td></tr>`; }).join("")}</tbody></table></div>
    <div><div class="eyebrow">Metres per minute</div><div class="chart" id="rM-${key}"></div><p class="small muted" style="margin-top:6px">The Merach's distance may read inaccurately, so compare rows with each other rather than with other machines.</p></div>
    <div><div class="eyebrow">Time in target heart rate zone (%)</div><div class="chart" id="rT-${key}"></div></div></section>`;
  const bind = () => {
    drawLine($(`#rM-${key}`), rows.filter(l => l.row.distance && l.row.seconds).map(l => ({ label: fmtShort(l.startedAt), v: l.row.distance / (l.row.seconds / 60), note: l.name })), { fmt: v => fmtNum(v, 1), unit: "m/min" });
    drawLine($(`#rT-${key}`), rows.map(l => { const st = hrStats(l, targetFor(l)); return st && st.inTarget != null ? { label: fmtShort(l.startedAt), v: st.inTarget * 100, note: l.name } : null; }).filter(Boolean), { fmt: v => fmtNum(v), unit: "%", color: "var(--good)" });
  };
  return { html, bind };
}
const targetForLog = l => { const { s } = sessFor(l); return s && s.targetHr ? s.targetHr : null; };

function renderProgProgress(app, id) {
  const p = S.progs.find(x => x.id === id); if (!p) { location.hash = "home"; return; }
  const w = progWeek(p), weeks = p.weeks || 4, rv = reviewInfo(p), c = progCounts(p);
  const logs = S.logs.filter(l => l.programmeId === p.id && l.status === "done");
  let h = topBar("Programme progress", "#prog-" + p.id, p.name) + `<div class="stack">`;
  h += `<div class="stats"><div class="stat"><div class="eyebrow">Week</div><div class="v">${Math.max(0, Math.min(w, weeks))}<small> of ${weeks}</small></div><div class="tiny muted">${fmtShort(progStart(p))} – ${fmtShort(progEnd(p))}</div></div>
    <div class="stat"><div class="eyebrow">Next review</div><div class="v">${rv.days}<small> days</small></div><div class="tiny muted">${fmtDate(rv.date)}</div></div>
    <div class="stat"><div class="eyebrow">Kept up</div><div class="v">${c.planned ? fmtNum(c.done / c.planned * 100) : "–"}<small>%</small></div><div class="tiny muted">${c.done} of ${c.planned} due so far</div></div></div>`;
  // grid
  const keys = (p.sessions || []).filter(s => (s.days || []).length);
  h += `<section class="card stack"><h3>Sessions done</h3><div class="tablewrap"><table><thead><tr><th>Week</th>${keys.map(s => `<th class="c">${esc(s.name)}</th>`).join("")}</tr></thead><tbody>`;
  for (let i = 1; i <= weeks; i++) {
    h += `<tr><td>${i}${weekLabel(p, i) ? ` <span class="tiny muted">${esc(weekLabel(p, i))}</span>` : ""}</td>`;
    keys.forEach(s => { const it = schedule(p, i).find(x => x.sess.key === s.key); const st = it ? statusOf({ ...it, p }) : "upcoming"; const dl = doneLog(p, s.key, i);
      h += `<td class="c">${dl ? `<a href="#log-${esc(dl.id)}" aria-label="Done"><span class="dot done"></span></a>` : `<span class="dot ${st}" title="${st}"></span>`}</td>`; });
    h += `</tr>`;
  }
  h += `</tbody></table></div><p class="tiny muted"><span class="dot done"></span> done &nbsp; <span class="dot missed"></span> missed &nbsp; <span class="dot today"></span> today &nbsp; <span class="dot"></span> to come</p></section>`;
  const ex = exerciseSection(logs.filter(l => l.kind !== "row"), "p"), hs = heartSection(logs, "p", targetForLog), rs = rowSection(logs, "p", targetForLog);
  h += ex.html + hs.html + rs.html;
  h += `<p class="small muted">Formal reassessment and programme review every ${plural(p.reviewEvery || 4, "week")}. The next one is due ${fmtDate(rv.date)}.</p></div>`;
  app.innerHTML = h; ex.bind(); hs.bind(); rs.bind();
}
function renderFitness(app) {
  const logs = S.logs.filter(l => l.status === "done");
  let h = topBar("Fitness progress", null, "All programmes") + `<div class="stack">`;
  if (!logs.length) { app.innerHTML = h + `<div class="card flat empty"><h3>Progress builds as you train</h3><p>After a few sessions you'll see strength, heart rate and rowing trends here.</p></div></div>`; return; }
  const last28 = logs.filter(l => l.startedAt > Date.now() - 28 * DAY);
  const mins = last28.reduce((a, l) => a + ((l.endedAt || l.startedAt) - l.startedAt) / 60000, 0);
  h += `<div class="stats"><div class="stat"><div class="eyebrow">Last 4 weeks</div><div class="v">${last28.length}<small> sessions</small></div></div><div class="stat"><div class="eyebrow">Time trained</div><div class="v">${fmtNum(mins / 60, 1)}<small> h</small></div></div><div class="stat"><div class="eyebrow">All time</div><div class="v">${logs.length}<small> sessions</small></div></div></div>`;
  const ex = exerciseSection(logs.filter(l => l.kind !== "row"), "f"), hs = heartSection(logs, "f", targetForLog), rs = rowSection(logs, "f", targetForLog);
  h += ex.html + hs.html + rs.html + `<p class="small muted">This is the first version of Fitness Progress. More measures (like resting heart rate and benchmark tests) can come next.</p></div>`;
  app.innerHTML = h; ex.bind(); hs.bind(); rs.bind();
}

/* ---------------- ME / SETTINGS ---------------- */
function renderMe(app) {
  const st = S.me.settings || {};
  let h = topBar("Me", null, "Settings") + `<div class="stack">`;
  h += `<section class="card stack"><h3>Heart rate</h3><p class="small muted">Your max heart rate sets the zones and effort points.</p>
    <div class="row nowrap"><label class="f grow">Max HR (bpm)<input id="sMax" inputmode="numeric" value="${st.maxHr || ""}" placeholder="${DEFAULT_MAX}"></label><label class="f grow">Resting HR (bpm)<input id="sRest" inputmode="numeric" value="${st.restHr || ""}" placeholder="optional"></label></div>
    <label class="f">Heart rate shortcut name (exactly as in the Shortcuts app)<input id="sShort" value="${esc(shortcutName())}" autocapitalize="off" autocorrect="off"></label>
    <button id="sSave">Save</button>${shortcutHelp()}</section>`;
  h += `<section class="card stack"><h3>Change PIN</h3><div class="row nowrap"><label class="f grow">Current PIN<input id="pOld" inputmode="numeric" maxlength="4" type="password" autocomplete="off"></label><label class="f grow">New PIN<input id="pNew" inputmode="numeric" maxlength="4" type="password" autocomplete="off"></label></div><button id="pGo">Change PIN</button></section>`;
  if (S.me.isAdmin) h += `<section class="card stack"><h3>Family</h3><p class="small muted">If someone forgets their PIN, reset it here. They choose a new one next time they tap their name.</p><div class="list" id="fam"></div></section>`;
  h += `<div class="row"><a class="btn" href="#who">Switch person</a><button class="ghost danger" id="lock">Lock: sign out on this phone</button></div>`;
  h += `<p class="tiny muted">Set &amp; Pulse · data saved to the family's Supabase database.</p></div>`;
  app.innerHTML = h;
  $("#sSave").onclick = () => { saveSettings({ ...st, maxHr: parseInt($("#sMax").value) || 0, restHr: parseInt($("#sRest").value) || 0, shortcutName: $("#sShort").value.trim() || "Workout HR" }); toast("Saved"); };
  $("#pGo").onclick = async () => { const o = $("#pOld").value, n = $("#pNew").value; if (!/^\d{4}$/.test(n)) return toast("The new PIN must be 4 digits.");
    try { const ok = await api("fit_change_pin", { p_token: S.token, p_old: o, p_new: n }); toast(ok ? "PIN changed" : "Current PIN is wrong."); if (ok) { $("#pOld").value = ""; $("#pNew").value = ""; } } catch (e) { toast(e.offline ? "No connection." : e.message); } };
  $("#lock").onclick = async () => { try { await api("fit_logout", { p_token: S.token }); } catch { } signOutLocal(); };
  if (S.me.isAdmin) (async () => { try { const ppl = await api("fit_people"); $("#fam").innerHTML = ppl.filter(x => x.id !== S.me.id).map(x => `<div class="row between nowrap"><span class="row nowrap"><span class="av s c-${esc(x.colour)}">${esc(x.name[0])}</span>${esc(x.name)} <span class="tiny muted">${x.hasPin ? "PIN set" : "no PIN yet"}</span></span>${x.hasPin ? `<button data-reset="${esc(x.id)}">Reset PIN</button>` : ""}</div>`).join("");
    $$("[data-reset]").forEach(b => confirmBtn(b, "Tap to confirm", async () => { try { await api("fit_reset_pin", { p_token: S.token, p_user: b.dataset.reset }); toast("PIN reset"); render(); } catch (e) { toast(e.message); } })); } catch (e) { $("#fam").innerHTML = `<p class="small muted">Can't load the family list offline.</p>`; } })();
}

/* ---------------- PROGRAMME EDITOR ---------------- */
let edWeek = 1;
function renderEdit(app, id) {
  let p = id === "new" ? null : (S._draft && S._draft.id === id ? S._draft : S.progs.find(x => x.id === id));
  if (!p) { if (id !== "new") { location.hash = "home"; return; }
    p = { id: uid(), name: "New programme", startDate: dayKey(addDays(dayStart(Date.now()), (8 - new Date().getDay()) % 7 || 7)), weeks: 4, reviewEvery: 4, notes: "", sessions: [{ key: "A", name: "Session A", kind: "strength", focus: "", days: [2], exercises: [], weeks: [{ n: 1, notes: "", ex: {} }] }] };
    p._new = true; S._draft = p; location.hash = "edit-" + p.id; return; }
  if (S._draft && S._draft.id !== id) S._draft = null;
  const weeks = p.weeks || 4; edWeek = Math.min(edWeek, weeks);
  let h = topBar(p._new ? "New programme" : "Edit programme", p._new ? "#home" : "#prog-" + p.id) + `<div class="stack">
    <label class="f">Name<input id="eName" value="${esc(p.name)}"></label>
    <div class="row nowrap"><label class="f grow">Start date<input type="date" id="eStart" value="${esc(p.startDate)}"></label><label class="f grow">Weeks<input id="eWeeks" inputmode="numeric" value="${weeks}"></label><label class="f grow">Review every (weeks)<input id="eRev" inputmode="numeric" value="${p.reviewEvery || 4}"></label></div>
    <label class="f">Notes<textarea id="eNotes" style="font-family:var(--body);font-size:14px;min-height:60px">${esc(p.notes || "")}</textarea></label>
    <div class="row between"><h2>Sessions</h2><div class="chips">${Array.from({ length: weeks }, (_, i) => `<button class="chip" data-ew="${i + 1}" aria-pressed="${edWeek === i + 1}">Wk ${i + 1}</button>`).join("")}</div></div>
    <p class="small muted">Targets below are for week ${edWeek}. Use "Copy to all weeks" to repeat them.</p>`;
  (p.sessions || []).forEach((s, si) => {
    const wd = weekDef(s, edWeek);
    h += `<section class="card stack" data-si="${si}"><div class="row nowrap"><input class="sName" value="${esc(s.name)}" aria-label="Session name"><select class="sKind" aria-label="Type" style="width:auto"><option value="strength" ${s.kind !== "row" ? "selected" : ""}>Strength</option><option value="row" ${s.kind === "row" ? "selected" : ""}>Row</option></select></div>
      <input class="sFocus" value="${esc(s.focus || "")}" placeholder="Focus, e.g. Legs + pull" aria-label="Focus">
      <div><div class="eyebrow" style="margin-bottom:4px">Days</div><div class="daypick">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="dayB" data-d="${d}" aria-pressed="${(s.days || []).includes(d)}">${DOW[d]}</button>`).join("")}</div></div>
      <label class="f">Week ${edWeek} notes<textarea class="wNotes" style="font-family:var(--body);font-size:13px;min-height:50px">${esc(wd.n === edWeek ? wd.notes || "" : "")}</textarea></label>`;
    if (s.kind === "row") {
      h += `<label class="f">Target heart rate (bpm, low–high)<div class="row nowrap"><input class="tLo" inputmode="numeric" value="${s.targetHr ? s.targetHr[0] : ""}" placeholder="low"><input class="tHi" inputmode="numeric" value="${s.targetHr ? s.targetHr[1] : ""}" placeholder="high"></div></label>
        <label class="f">Week ${edWeek} plan: one part per line, as Part | Time | Heart rate | Rate<textarea class="wParts">${esc((wd.parts || []).map(x => [x.part, x.time, x.hr, x.rate].join(" | ")).join("\n"))}</textarea></label>
        <label class="f">Week ${edWeek} total minutes<input class="wMin" inputmode="numeric" value="${wd.minutes || ""}"></label>`;
    } else {
      (s.exercises || []).forEach(ex => { const t = (wd.ex || {})[ex.id] || {};
        h += `<div class="ed-ex" data-ex="${esc(ex.id)}"><div class="row nowrap"><input class="xName" value="${esc(ex.name)}" aria-label="Exercise"><select class="xMeas" style="width:auto" aria-label="Measure"><option value="reps" ${ex.measure !== "secs" ? "selected" : ""}>Reps</option><option value="secs" ${ex.measure === "secs" ? "selected" : ""}>Secs</option></select></div>
          <input class="xNote" value="${esc(ex.note || "")}" placeholder="Note (optional)" style="font-size:13px;min-height:34px">
          <div class="ed-nums"><label class="f">Sets<input class="xSets" inputmode="numeric" value="${t.sets || ""}"></label><label class="f">${ex.measure === "secs" ? "Secs" : "Reps"}<input class="xReps" inputmode="numeric" value="${t.reps || ""}"></label><label class="f">kg<input class="xW" inputmode="decimal" value="${t.weight || ""}"></label><label class="f">Rest s<input class="xRest" inputmode="numeric" value="${t.rest || ""}"></label><button class="ghost danger xDel" aria-label="Remove ${esc(ex.name)}">✕</button></div></div>`; });
      h += `<button class="ghost addEx" style="align-self:flex-start">+ Add exercise</button>`;
    }
    h += `<div class="row between"><button class="copyAll">Copy week ${edWeek} to all weeks</button><button class="ghost danger delS">Remove session</button></div></section>`;
  });
  h += `<button id="addS">+ Add session</button><button class="primary wide" id="eSave">Save programme</button>${p._new ? "" : `<button class="ghost danger" id="eDel">Delete programme</button>`}</div>`;
  app.innerHTML = h;
  const collect = () => {
    p.name = $("#eName").value.trim() || "Programme"; p.startDate = $("#eStart").value || p.startDate; p.weeks = Math.max(1, Math.min(52, parseInt($("#eWeeks").value) || 4)); p.reviewEvery = Math.max(1, parseInt($("#eRev").value) || 4); p.notes = $("#eNotes").value;
    $$("[data-si]").forEach(sec => { const s = p.sessions[+sec.dataset.si];
      const rowUI = !!$(".wParts", sec);
      s.name = $(".sName", sec).value.trim() || "Session"; s.kind = $(".sKind", sec).value; s.focus = $(".sFocus", sec).value; s.days = $$(".dayB", sec).filter(b => b.getAttribute("aria-pressed") === "true").map(b => +b.dataset.d);
      s.weeks = s.weeks || []; let w = s.weeks.find(x => x.n === edWeek); if (!w) { const base = weekDef(s, edWeek); w = JSON.parse(JSON.stringify({ ...base, n: edWeek })); s.weeks.push(w); s.weeks.sort((a, b) => a.n - b.n); }
      w.notes = $(".wNotes", sec).value;
      if (rowUI) { const lo = parseInt($(".tLo", sec).value), hi = parseInt($(".tHi", sec).value); s.targetHr = lo && hi ? [lo, hi] : null; w.minutes = parseInt($(".wMin", sec).value) || 0;
        w.parts = $(".wParts", sec).value.split("\n").map(x => x.trim()).filter(Boolean).map(x => { const [part, time, hr, rate] = x.split("|").map(y => (y || "").trim()); return { part, time, hr, rate }; }); }
      else { w.ex = w.ex || {}; $$(".ed-ex", sec).forEach(row => { const ex = s.exercises.find(e => e.id === row.dataset.ex); ex.name = $(".xName", row).value.trim() || "Exercise"; ex.measure = $(".xMeas", row).value; ex.note = $(".xNote", row).value;
        const prev = w.ex[ex.id] || {}; w.ex[ex.id] = { ...prev, sets: parseInt($(".xSets", row).value) || 0, reps: parseFloat($(".xReps", row).value) || 0, weight: parseFloat($(".xW", row).value) || 0, rest: parseInt($(".xRest", row).value) || 0 }; }); }
    });
  };
  S._draft = p;
  $$("[data-ew]").forEach(b => b.onclick = () => { collect(); edWeek = +b.dataset.ew; render(); });
  $$(".dayB").forEach(b => b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"));
  $$(".sKind").forEach(sel => sel.onchange = () => { collect(); render(); });
  $$(".addEx").forEach(b => b.onclick = () => { collect(); const s = p.sessions[+b.closest("[data-si]").dataset.si]; const id = uid(); s.exercises = s.exercises || []; s.exercises.push({ id, name: "New exercise", measure: "reps", note: "" }); (s.weeks || []).forEach(w => { w.ex = w.ex || {}; w.ex[id] = { sets: 3, reps: 10, weight: 0, rest: 90 }; }); render(); });
  $$(".xDel").forEach(b => b.onclick = () => { collect(); const s = p.sessions[+b.closest("[data-si]").dataset.si]; const id = b.closest("[data-ex]").dataset.ex; s.exercises = s.exercises.filter(e => e.id !== id); render(); });
  $$(".copyAll").forEach(b => b.onclick = () => { collect(); const s = p.sessions[+b.closest("[data-si]").dataset.si]; const src = s.weeks.find(w => w.n === edWeek); s.weeks = Array.from({ length: p.weeks }, (_, i) => ({ ...JSON.parse(JSON.stringify(src)), n: i + 1 })); toast(`Week ${edWeek} copied to all weeks`); render(); });
  $$(".delS").forEach(b => confirmBtn(b, "Tap again to remove", () => { collect(); p.sessions.splice(+b.closest("[data-si]").dataset.si, 1); render(); }));
  $("#addS").onclick = () => { collect(); const used = p.sessions.map(s => s.key); let k = "A"; for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.includes(c)) { k = c; break; } p.sessions.push({ key: k + (used.includes(k) ? uid().slice(-3) : ""), name: "Session " + k, kind: "strength", focus: "", days: [], exercises: [], weeks: [{ n: 1, notes: "", ex: {} }] }); render(); };
  $("#eSave").onclick = () => { collect(); delete p._new; S._draft = null; saveProg(p); toast("Programme saved"); location.hash = "prog-" + p.id; };
  const del = $("#eDel"); if (del) confirmBtn(del, "Tap again to delete (sessions stay in History)", () => { S._draft = null; deleteProg(p.id); location.hash = "home"; });
}

/* ---------------- boot ---------------- */
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { const v = parts()[0]; if (["log", "pprog", "fitness"].includes(v)) render(); }, 250); });
if (!location.hash) location.hash = ls.get("current", null) ? "home" : "who";
S.uidCur = ls.get("current", null);
render();
})();
