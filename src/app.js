'use strict';
/* global api */

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtClock = (sec) => `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
function fmtDur(sec) {
  if (sec < 60) return sec > 0 ? '<1m' : '0m';
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
const intOr = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

let data = null;
const ui = { view: 'today', mode: 'stopwatch', h: 1, m: 0, topicId: null, note: '', date: dstr(), query: '', openPlans: new Set(), lastSec: -1 };

function save(backup = true) {
  api.save(data, backup).catch(() => toast('Could not save your data!'));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3500);
}

// ---------- topics ----------
const byId = (id) => data.topics.find((t) => t.id === id);
const roots = () => data.topics.filter((t) => !t.parentId || !byId(t.parentId));
const kids = (id) => data.topics.filter((t) => t.parentId === id);

function flat() {
  const out = [];
  const walk = (t, depth) => { out.push({ t, depth }); kids(t.id).forEach((c) => walk(c, depth + 1)); };
  roots().forEach((r) => walk(r, 0));
  return out;
}

function topicPath(id, fallback) {
  const parts = [];
  let t = byId(id);
  if (!t) return fallback || '(deleted topic)';
  for (let i = 0; t && i < 10; i++) { parts.unshift(t.name); t = t.parentId ? byId(t.parentId) : null; }
  return parts.join(' / ');
}

function descendants(id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of data.topics) if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
  }
  return ids;
}

function topicOptions(selected, { onlyRoots = false, none = null } = {}) {
  let html = none ? `<option value="">${esc(none)}</option>` : '';
  for (const { t, depth } of flat()) {
    if (onlyRoots && depth > 0) continue;
    html += `<option value="${esc(t.id)}"${t.id === selected ? ' selected' : ''}>${depth ? '  └ ' : ''}${esc(t.name)}</option>`;
  }
  return html;
}

// ---------- timer ----------
const T = () => data.activeTimer;
const elapsedMs = () => {
  const t = T();
  return t ? t.accumMs + (t.runningSince ? Date.now() - t.runningSince : 0) : 0;
};

function secondsFor(id, date) {
  const ids = descendants(id);
  let s = 0;
  for (const x of data.sessions) if (x.date === date && ids.has(x.topicId)) s += x.seconds;
  const t = T();
  if (t && date === dstr() && ids.has(t.topicId)) s += Math.floor(elapsedMs() / 1000);
  return s;
}

function startTimer() {
  const topicId = ui.topicId;
  if (!byId(topicId)) { toast('Add a topic first.'); return; }
  let targetSec = 0;
  if (ui.mode === 'countdown') {
    targetSec = ui.h * 3600 + ui.m * 60;
    if (targetSec <= 0) { toast('Set a countdown time first.'); return; }
  }
  const now = Date.now();
  data.activeTimer = { topicId, mode: ui.mode, targetSec, accumMs: 0, runningSince: now, startedAt: now, lastBeat: now, note: ui.note };
  ui.lastSec = -1;
  save(false);
  render();
}

function pauseTimer() {
  const t = T();
  if (!t || !t.runningSince) return;
  t.accumMs += Date.now() - t.runningSince;
  t.runningSince = null;
  save(false);
  api.tray('Time Tracker – paused');
  render();
}

function resumeTimer() {
  const t = T();
  if (!t || t.runningSince) return;
  t.runningSince = Date.now();
  t.lastBeat = t.runningSince;
  ui.lastSec = -1;
  save(false);
  render();
}

function finishTimer(auto = false) {
  const t = T();
  if (!t) return;
  let sec = Math.round(elapsedMs() / 1000);
  if (auto && t.mode === 'countdown') sec = Math.min(sec, t.targetSec);
  data.activeTimer = null;
  ui.note = '';
  ui.lastSec = -1;
  if (sec >= 1) {
    data.sessions.push({
      id: uid(), topicId: t.topicId, path: topicPath(t.topicId), date: dstr(new Date(t.startedAt)),
      start: new Date(t.startedAt).toISOString(), seconds: sec, mode: t.mode, note: (t.note || '').trim(),
    });
    toast(`Saved ${fmtDur(sec)} on ${topicPath(t.topicId)}`);
  }
  save(true);
  api.tray('Time Tracker');
  if (auto) {
    api.notify('Time is up', `${topicPath(t.topicId)} – ${fmtDur(sec)} logged`);
    if (data.settings.sound) beep();
  }
  render();
}

async function discardTimer() {
  if (!(await confirmBox('Discard this timer without saving the time?', 'Discard'))) return;
  data.activeTimer = null;
  ui.lastSec = -1;
  save(false);
  api.tray('Time Tracker');
  render();
}

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((delay) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + 0.22);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* no audio available */ }
}

function tick() {
  const t = T();
  if (!t || !t.runningSince) return;
  const sec = Math.floor(elapsedMs() / 1000);
  if (sec === ui.lastSec) return;
  ui.lastSec = sec;
  if (t.mode === 'countdown' && sec >= t.targetSec) { finishTimer(true); return; }
  updateClock();
  if (sec % 5 === 0) renderProgress();
  if (document.hidden) api.tray(`${clockText()} – ${topicPath(t.topicId)}`);
}

function clockText() {
  const t = T();
  if (!t) return fmtClock(ui.mode === 'countdown' ? ui.h * 3600 + ui.m * 60 : 0);
  const sec = Math.floor(elapsedMs() / 1000);
  return fmtClock(t.mode === 'countdown' ? Math.max(0, t.targetSec - sec) : sec);
}

function updateClock() {
  const t = T();
  const side = $('#sideTimer');
  side.innerHTML = t ? `${esc(topicPath(t.topicId))}<b>${clockText()}</b>${t.runningSince ? 'running' : 'paused'}` : '';
  const el = $('#clock');
  if (!el) return;
  el.textContent = clockText();
  el.classList.toggle('run', !!(t && t.runningSince));
  const sub = $('#clockSub'), bar = $('#clockBar');
  if (!t) { sub.textContent = ui.mode === 'countdown' ? 'Countdown' : 'Stopwatch'; bar.style.width = '0%'; return; }
  const sec = Math.floor(elapsedMs() / 1000);
  sub.textContent = (t.runningSince ? 'Running' : 'Paused') + (t.mode === 'countdown' ? ` · ${fmtClock(t.targetSec)} countdown` : ' · stopwatch');
  bar.style.width = t.mode === 'countdown' ? Math.min(100, (sec / t.targetSec) * 100) + '%' : '0%';
}

// ---------- modal ----------
function fieldHtml(f) {
  const id = 'f_' + f.name, v = f.value ?? '';
  let c;
  if (f.type === 'select') {
    c = `<select id="${id}" name="${f.name}">${f.options.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(v) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    c = `<textarea id="${id}" name="${f.name}" rows="3">${esc(v)}</textarea>`;
  } else {
    c = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}"${f.required ? ' required' : ''}${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}>`;
  }
  return `<label class="fld"><span>${esc(f.label)}</span>${c}</label>`;
}

function modal({ title, message = '', fields = [], ok = 'Save' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}${fields.map(fieldHtml).join('')}
      <div class="actions"><button value="ok" class="primary">${esc(ok)}</button><button value="cancel" class="ghost" formnovalidate>Cancel</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      const out = {};
      const accepted = d.returnValue === 'ok';
      if (accepted) for (const f of fields) out[f.name] = d.querySelector(`[name="${f.name}"]`).value;
      d.remove();
      resolve(accepted ? out : null);
    });
    d.showModal();
    const first = d.querySelector('input,textarea,select');
    if (first) first.focus();
  });
}
const confirmBox = async (message, ok = 'OK') => !!(await modal({ title: 'Please confirm', message, ok }));

// ---------- views ----------
function render() {
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === ui.view));
  const views = { today: renderToday, topics: renderTopics, history: renderHistory, search: renderSearch, settings: renderSettings };
  views[ui.view]($('#main'));
  updateClock();
}

// --- Today ---
function renderToday(m) {
  const t = T();
  if (!data.topics.length) {
    m.innerHTML = '<h1>Today</h1><div class="card empty">Add a topic first (Topics page) to start tracking.</div>';
    return;
  }
  if (!byId(ui.topicId)) ui.topicId = data.topics[0].id;
  const topicId = t ? t.topicId : ui.topicId;
  const mode = t ? t.mode : ui.mode;
  const topic = byId(topicId);
  const remaining = topic && topic.targetMin ? Math.max(0, topic.targetMin * 60 - secondsFor(topicId, dstr())) : 0;
  const plans = data.plans.filter((p) => p.topicId === topicId);

  let buttons;
  if (!t) buttons = '<button class="primary" data-a="start">Start</button>';
  else buttons = `${t.runningSince ? '<button data-a="pause">Pause</button>' : '<button class="primary" data-a="resume">Resume</button>'}
    <button class="primary" data-a="finish">Finish &amp; Save</button><button class="danger" data-a="discard">Discard</button>`;

  m.innerHTML = `<h1>Today <span class="muted small">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span></h1>
  <div class="grid2"><section class="card">
    <label class="fld"><span>Topic</span><select id="tTopic"${t ? ' disabled' : ''}>${topicOptions(topicId)}</select></label>
    <div class="row"><div class="seg">
      <button data-a="mode" data-m="stopwatch" class="${mode === 'stopwatch' ? 'on' : ''}"${t ? ' disabled' : ''}>Stopwatch</button>
      <button data-a="mode" data-m="countdown" class="${mode === 'countdown' ? 'on' : ''}"${t ? ' disabled' : ''}>Countdown</button></div></div>
    ${!t && mode === 'countdown' ? `<div class="row" style="margin-top:12px">
      <button data-a="preset" data-min="25">25m</button><button data-a="preset" data-min="45">45m</button>
      <button data-a="preset" data-min="60">1h</button><button data-a="preset" data-min="120">2h</button>
      <input id="tH" class="timebox" type="number" min="0" max="23" value="${ui.h}" aria-label="hours"> h
      <input id="tM" class="timebox" type="number" min="0" max="59" value="${ui.m}" aria-label="minutes"> m
      ${remaining ? `<button data-a="remaining" class="ghost">Use remaining target (${fmtDur(remaining)})</button>` : ''}</div>` : ''}
    <label class="fld" style="margin-top:12px"><span>What are you studying / what did you learn?</span>
      <textarea id="tNote" rows="2" placeholder="e.g. Pods, Deployments and Services">${esc(t ? t.note : ui.note)}</textarea></label>
    <div class="clock" id="clock"></div><div class="clocksub" id="clockSub"></div>
    <div class="bar"><i id="clockBar" style="width:0%"></i></div>
    <div class="ctrl">${buttons}</div>
    ${plans.length ? `<h2 style="margin-top:18px">To study – ${esc(topic.name)}</h2>${plans.map(planHtml).join('')}` : ''}
  </section>
  <div><section class="card"><h2>Today's progress</h2><div id="progress"></div></section>
  <section class="card"><h2>Today's sessions</h2><div id="todaySessions"></div></section></div></div>`;
  renderProgress();
  renderTodaySessions();
}

function planHtml(p) {
  return `<div class="plan${p.done ? ' done' : ''}"><input type="checkbox" data-a="togglePlan" data-id="${p.id}"${p.done ? ' checked' : ''} aria-label="done"><span>${esc(p.text)}</span></div>`;
}

function renderProgress() {
  const box = $('#progress');
  if (!box) return;
  const today = dstr();
  let total = 0;
  for (const r of roots()) total += secondsFor(r.id, today);
  const rows = flat().map(({ t, depth }) => {
    const sec = secondsFor(t.id, today), target = (t.targetMin || 0) * 60;
    const pct = target ? Math.min(100, (sec / target) * 100) : 0;
    return `<div class="prow d${Math.min(depth, 1)}"><div class="top"><span>${esc(t.name)}</span>
      <span class="muted">${fmtDur(sec)}${target ? ' / ' + fmtDur(target) : ''}</span></div>
      ${target ? `<div class="bar"><i class="${sec >= target ? 'done' : ''}" style="width:${pct}%"></i></div>` : ''}</div>`;
  });
  box.innerHTML = `<div class="muted small" style="margin-bottom:10px">Total today: <b>${fmtDur(total)}</b></div>${rows.join('')}`;
}

function sessionRow(s) {
  const time = s.mode === 'manual' ? 'manual entry' : new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + s.mode;
  return `<div class="srow"><div class="sinfo"><b>${esc(topicPath(s.topicId, s.path))}</b> <span class="muted small">${esc(time)}</span>
    ${s.note ? `<div class="snote">${esc(s.note)}</div>` : ''}</div><div class="sdur">${fmtDur(s.seconds)}</div>
    <div><button class="icon" data-a="editNote" data-id="${s.id}" title="Edit note">✎</button><button class="icon" data-a="delSession" data-id="${s.id}" title="Delete">✕</button></div></div>`;
}

function renderTodaySessions() {
  const box = $('#todaySessions');
  if (!box) return;
  const list = data.sessions.filter((s) => s.date === dstr()).sort((a, b) => b.start.localeCompare(a.start));
  box.innerHTML = list.length ? list.map(sessionRow).join('') : '<div class="empty">Nothing logged yet today.</div>';
}

// --- Topics ---
function renderTopics(m) {
  const rows = flat().map(({ t, depth }) => {
    const open = ui.openPlans.has(t.id);
    const plans = data.plans.filter((p) => p.topicId === t.id);
    const pending = plans.filter((p) => !p.done).length;
    return `<div class="trow d${Math.min(depth, 1)}"><span class="name">${esc(t.name)}</span>
      <span class="muted small">${t.targetMin ? fmtDur(t.targetMin * 60) + ' / day' : 'no target'}</span>
      <button class="icon" data-a="togglePlans" data-id="${t.id}" title="Things to study">${open ? '▾' : '▸'} Plan${pending ? ` (${pending})` : ''}</button>
      ${depth === 0 ? `<button class="icon" data-a="addTopic" data-parent="${t.id}">+ Sub</button>` : ''}
      <button class="icon" data-a="editTopic" data-id="${t.id}">Edit</button>
      <button class="icon" data-a="delTopic" data-id="${t.id}">✕</button></div>
      ${open ? `<div class="plans">${plans.map((p) => `<div class="plan${p.done ? ' done' : ''}"><input type="checkbox" data-a="togglePlan" data-id="${p.id}"${p.done ? ' checked' : ''} aria-label="done"><span>${esc(p.text)}</span><button class="icon" data-a="delPlan" data-id="${p.id}">✕</button></div>`).join('')}
        <div class="row" style="margin-top:6px"><input id="plan-${t.id}" class="grow" placeholder="Add something to study… (Enter)" data-plan-for="${t.id}" maxlength="200"></div></div>` : ''}`;
  });
  m.innerHTML = `<h1>Topics</h1><section class="card"><div class="row" style="margin-bottom:8px"><button class="primary" data-a="addTopic" data-parent="">+ Add main topic</button>
    <span class="muted small">Set a daily target on a topic to see progress on the Today page. A main topic counts the time of its subtopics.</span></div>
    ${rows.join('') || '<div class="empty">No topics yet.</div>'}</section>`;
}

function topicFields(t, { parentId = '', hasKids = false } = {}) {
  const roots_ = roots().filter((r) => !t || r.id !== t.id);
  const fields = [{ name: 'name', label: 'Name', value: t ? t.name : '', required: true }];
  if (!hasKids) {
    fields.push({ name: 'parent', label: 'Belongs to', type: 'select', value: parentId, options: [{ v: '', l: '(main topic)' }].concat(roots_.map((r) => ({ v: r.id, l: r.name }))) });
  }
  const tm = t ? t.targetMin || 0 : 0;
  fields.push({ name: 'h', label: 'Daily target – hours', type: 'number', value: Math.floor(tm / 60), min: 0, max: 23 });
  fields.push({ name: 'm', label: 'Daily target – minutes', type: 'number', value: tm % 60, min: 0, max: 59 });
  return fields;
}

// --- History ---
function totalsByDay() {
  const map = {};
  for (const s of data.sessions) map[s.date] = (map[s.date] || 0) + s.seconds;
  return map;
}

function streak(map) {
  const d = new Date();
  if (!map[dstr(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (map[dstr(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderHistory(m) {
  const map = totalsByDay();
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const sumFrom = (from) => Object.entries(map).reduce((a, [d, s]) => (d >= from ? a + s : a), 0);
  const all = Object.values(map).reduce((a, b) => a + b, 0);
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
  const max = Math.max(1, ...days.map((d) => map[dstr(d)] || 0));
  const st = streak(map);

  m.innerHTML = `<h1>History</h1>
  <div class="stats">
    <div class="stat"><span class="muted small">Today</span><b>${fmtDur(map[dstr()] || 0)}</b></div>
    <div class="stat"><span class="muted small">This week</span><b>${fmtDur(sumFrom(dstr(weekStart)))}</b></div>
    <div class="stat"><span class="muted small">This month</span><b>${fmtDur(sumFrom(monthStart))}</b></div>
    <div class="stat"><span class="muted small">Streak</span><b>${st} day${st === 1 ? '' : 's'}</b></div>
    <div class="stat"><span class="muted small">All time</span><b>${fmtDur(all)}</b></div></div>
  <section class="card"><h2>Last 14 days</h2><div class="chart">${days.map((d) => {
    const k = dstr(d), v = map[k] || 0;
    return `<button class="col${k === ui.date ? ' sel' : ''}" data-a="pickDay" data-d="${k}" title="${k}: ${fmtDur(v)}"><i style="height:${v ? Math.max(3, (v / max) * 100) : 0}%"></i><span>${d.getDate()}</span></button>`;
  }).join('')}</div></section>
  <section class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">Day</h2>
    <input type="date" id="hDate" value="${ui.date}" style="width:auto"><span class="grow"></span>
    <button data-a="addManual">+ Add manual entry</button></div><div id="dayBox"></div></section>`;
  renderDay();
}

function renderDay() {
  const box = $('#dayBox');
  if (!box) return;
  const list = data.sessions.filter((s) => s.date === ui.date).sort((a, b) => a.start.localeCompare(b.start));
  const total = list.reduce((a, s) => a + s.seconds, 0);
  const per = new Map();
  for (const s of list) { const k = topicPath(s.topicId, s.path); per.set(k, (per.get(k) || 0) + s.seconds); }
  box.innerHTML = list.length
    ? `<div class="muted small" style="margin-bottom:8px">Total <b>${fmtDur(total)}</b> — ${[...per].map(([k, v]) => `${esc(k)}: ${fmtDur(v)}`).join(' · ')}</div>${list.map(sessionRow).join('')}`
    : '<div class="empty">No sessions on this day.</div>';
}

// --- Search ---
function renderSearch(m) {
  m.innerHTML = `<h1>Search</h1><section class="card"><input id="q" type="search" placeholder="Search topics, things to study, and session notes…" value="${esc(ui.query)}"></section><div id="results"></div>`;
  $('#q').focus();
  renderResults();
}

function renderResults() {
  const box = $('#results');
  if (!box) return;
  const words = ui.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.innerHTML = '<div class="empty">Type to search.</div>'; return; }
  const hit = (s) => { const l = s.toLowerCase(); return words.every((w) => l.includes(w)); };
  const topics = data.topics.filter((t) => hit(topicPath(t.id)));
  const plans = data.plans.filter((p) => hit(p.text + ' ' + topicPath(p.topicId)));
  const sessions = data.sessions.filter((s) => hit(topicPath(s.topicId, s.path) + ' ' + (s.note || '') + ' ' + s.date))
    .sort((a, b) => b.start.localeCompare(a.start));
  const section = (title, items) => (items.length ? `<section class="card"><h2>${title} (${items.length})</h2>${items.join('')}</section>` : '');
  const out = section('Topics', topics.map((t) => `<div class="srow"><div class="sinfo"><b>${esc(topicPath(t.id))}</b></div><div class="muted">${t.targetMin ? fmtDur(t.targetMin * 60) + ' / day' : ''}</div></div>`))
    + section('Things to study', plans.map((p) => `<div class="srow"><div class="sinfo">${p.done ? '✓ ' : ''}${esc(p.text)} <span class="tag">${esc(topicPath(p.topicId))}</span></div></div>`))
    + section('Sessions', sessions.slice(0, 100).map((s) => `<div class="srow"><div class="sinfo"><b>${esc(topicPath(s.topicId, s.path))}</b> <span class="muted small">${s.date}</span>${s.note ? `<div class="snote">${esc(s.note)}</div>` : ''}</div>
      <div class="sdur">${fmtDur(s.seconds)}</div><button class="icon" data-a="gotoDay" data-d="${s.date}">View</button></div>`));
  box.innerHTML = out || '<div class="empty">Nothing found.</div>';
}

// --- Settings ---
async function renderSettings(m) {
  const s = data.settings;
  const login = await api.getLogin().catch(() => false);
  if (ui.view !== 'settings') return;
  m.innerHTML = `<h1>Settings</h1>
  <section class="card"><h2>General</h2>
    <div class="setrow"><label for="s_minimizeToTray">Keep running in the system tray when the window is closed</label><input type="checkbox" id="s_minimizeToTray" data-set="minimizeToTray"${s.minimizeToTray ? ' checked' : ''}></div>
    <div class="setrow"><label for="s_sound">Play a sound when a countdown ends</label><input type="checkbox" id="s_sound" data-set="sound"${s.sound ? ' checked' : ''}></div>
    <div class="setrow"><label for="s_login">Start Time Tracker when Windows starts</label><input type="checkbox" id="s_login" data-a="login"${login ? ' checked' : ''}></div></section>
  <section class="card"><h2>Backup</h2>
    <p class="muted small" style="margin-top:0">Your data is also copied to Excel-friendly CSV files and daily snapshots after every change, so nothing is lost if the app ever breaks.</p>
    <div class="path" id="bkInfo">…</div>
    <div class="row" style="margin-top:12px"><button data-a="backupNow">Back up now</button><button data-a="openBackup">Open backup folder</button>
      <button data-a="chooseBackup">Change folder…</button><button data-a="openData">Open data folder</button><button data-a="restore" class="danger">Restore from file…</button></div></section>`;
  refreshBackupInfo();
}

async function refreshBackupInfo(extra = '') {
  const el = $('#bkInfo');
  if (!el) return;
  const info = await api.backupInfo();
  el.innerHTML = `Backup folder: ${esc(info.dir)}<br>Data file: ${esc(info.dataFile)}<br>Last backup this session: ${info.last ? new Date(info.last).toLocaleTimeString() : 'not yet'}${extra ? '<br>' + esc(extra) : ''}`;
}

// ---------- actions ----------
const actions = {
  nav(b) { ui.view = b.dataset.v; render(); },
  mode(b) { if (!T()) { ui.mode = b.dataset.m; render(); } },
  preset(b) { const mins = +b.dataset.min; ui.h = Math.floor(mins / 60); ui.m = mins % 60; render(); },
  remaining() {
    const tp = byId(ui.topicId);
    const left = Math.ceil(Math.max(0, tp.targetMin * 60 - secondsFor(tp.id, dstr())) / 60);
    ui.h = Math.floor(left / 60); ui.m = left % 60; render();
  },
  start: startTimer,
  pause: pauseTimer,
  resume: resumeTimer,
  finish: () => finishTimer(false),
  discard: discardTimer,

  togglePlan(b) {
    const p = data.plans.find((x) => x.id === b.dataset.id);
    if (p) { p.done = b.checked; save(); render(); }
  },
  togglePlans(b) { const id = b.dataset.id; ui.openPlans.has(id) ? ui.openPlans.delete(id) : ui.openPlans.add(id); render(); },
  delPlan(b) { data.plans = data.plans.filter((p) => p.id !== b.dataset.id); save(); render(); },

  async addTopic(b) {
    const parentId = b.dataset.parent || '';
    const r = await modal({ title: parentId ? 'Add subtopic' : 'Add main topic', fields: topicFields(null, { parentId }) });
    if (!r) return;
    data.topics.push({ id: uid(), name: r.name.trim(), parentId: r.parent || null, targetMin: intOr(r.h) * 60 + intOr(r.m) });
    save(); render();
  },
  async editTopic(b) {
    const t = byId(b.dataset.id);
    const r = await modal({ title: 'Edit topic', fields: topicFields(t, { parentId: t.parentId || '', hasKids: kids(t.id).length > 0 }) });
    if (!r) return;
    t.name = r.name.trim();
    if ('parent' in r) t.parentId = r.parent || null;
    t.targetMin = intOr(r.h) * 60 + intOr(r.m);
    save(); render();
  },
  async delTopic(b) {
    const ids = descendants(b.dataset.id);
    if (T() && ids.has(T().topicId)) { toast('Finish or discard the running timer first.'); return; }
    if (!(await confirmBox(`Delete "${byId(b.dataset.id).name}" and its subtopics? Past sessions stay in your history.`, 'Delete'))) return;
    for (const s of data.sessions) if (ids.has(s.topicId) && !s.path) s.path = topicPath(s.topicId);
    data.topics = data.topics.filter((t) => !ids.has(t.id));
    data.plans = data.plans.filter((p) => !ids.has(p.topicId));
    save(); render();
  },

  pickDay(b) { ui.date = b.dataset.d; render(); },
  gotoDay(b) { ui.date = b.dataset.d; ui.view = 'history'; render(); },
  async addManual() {
    if (!data.topics.length) { toast('Add a topic first.'); return; }
    const r = await modal({ title: 'Add manual entry', fields: [
      { name: 'topic', label: 'Topic', type: 'select', value: ui.topicId, options: flat().map(({ t, depth }) => ({ v: t.id, l: (depth ? '  └ ' : '') + t.name })) },
      { name: 'date', label: 'Date', type: 'date', value: ui.date, required: true },
      { name: 'min', label: 'Minutes studied', type: 'number', value: 30, min: 1, max: 1440, required: true },
      { name: 'note', label: 'Note', type: 'textarea' },
    ] });
    if (!r) return;
    const [y, mo, d] = r.date.split('-').map(Number);
    data.sessions.push({ id: uid(), topicId: r.topic, path: topicPath(r.topic), date: r.date, start: new Date(y, mo - 1, d, 12).toISOString(), seconds: intOr(r.min, 1) * 60, mode: 'manual', note: r.note.trim() });
    ui.date = r.date;
    save(); render();
  },
  async editNote(b) {
    const s = data.sessions.find((x) => x.id === b.dataset.id);
    const r = await modal({ title: 'Edit note', fields: [{ name: 'note', label: 'Note', type: 'textarea', value: s.note }] });
    if (!r) return;
    s.note = r.note.trim();
    save(); render();
  },
  async delSession(b) {
    if (!(await confirmBox('Delete this session?', 'Delete'))) return;
    data.sessions = data.sessions.filter((x) => x.id !== b.dataset.id);
    save(); render();
  },

  async login(b) { b.checked = await api.setLogin(b.checked); },
  async backupNow() {
    const r = await api.backupNow();
    refreshBackupInfo(r && r.errors && r.errors.length ? 'Problem: ' + r.errors.join('; ') : 'Backup completed.');
  },
  openBackup: () => api.openBackupDir(),
  openData: () => api.openDataDir(),
  async chooseBackup() {
    const dir = await api.chooseBackupDir();
    if (!dir) return;
    data.settings.backupDir = dir;
    await api.save(data, false);
    await api.backupNow();
    refreshBackupInfo('Backup folder changed.');
  },
  async restore() {
    if (T()) { toast('Finish or discard the running timer first.'); return; }
    if (!(await confirmBox('Replace ALL current data with a backup file? Your current data is saved as a "pre-restore" snapshot first.', 'Choose file'))) return;
    const r = await api.restore();
    if (r.canceled) return;
    if (!r.ok) { toast(r.error); return; }
    data = r.data;
    ui.topicId = null;
    save();
    toast('Backup restored.');
    render();
  },
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (b && b.type !== 'checkbox' && actions[b.dataset.a]) actions[b.dataset.a](b, e);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.a && el.type === 'checkbox' && actions[el.dataset.a]) { actions[el.dataset.a](el); return; }
  if (el.dataset.set) { data.settings[el.dataset.set] = el.checked; save(false); return; }
  if (el.id === 'tTopic') {
    ui.topicId = el.value;
    data.settings.lastTopicId = el.value;
    save(false);
    render();
  } else if (el.id === 'hDate') {
    if (el.value) { ui.date = el.value; render(); }
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'tNote') { if (T()) T().note = el.value; else ui.note = el.value; }
  else if (el.id === 'tH') { ui.h = Math.min(23, intOr(el.value)); updateClock(); }
  else if (el.id === 'tM') { ui.m = Math.min(59, intOr(el.value)); updateClock(); }
  else if (el.id === 'q') { ui.query = el.value; renderResults(); }
});

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key === 'Enter' && el.dataset && el.dataset.planFor) {
    const text = el.value.trim();
    if (!text) return;
    const id = el.dataset.planFor;
    data.plans.push({ id: uid(), topicId: id, text, done: false, created: dstr() });
    save();
    render();
    const next = $('#plan-' + id);
    if (next) next.focus();
  }
});

// ---------- startup ----------
async function init() {
  const res = await api.load();
  data = res.data;
  ui.topicId = data.settings.lastTopicId;
  const t = T();
  if (t && t.runningSince) { // the app was closed or crashed while running: resume paused at the last heartbeat
    t.accumMs += Math.max(0, (t.lastBeat || t.runningSince) - t.runningSince);
    t.runningSince = null;
    save(false);
    toast('Your timer was paused when the app last closed. Resume or finish it.');
  }
  if (res.notice) toast(res.notice);
  render();

  setInterval(tick, 500);
  setInterval(() => {
    const cur = T();
    if (cur && cur.runningSince) { cur.lastBeat = Date.now(); save(false); }
  }, 15000);

  api.onSuspend(() => {
    if (T() && T().runningSince) { pauseTimer(); toast('Timer paused because the computer went to sleep.'); }
  });

  window.addEventListener('beforeunload', () => {
    const cur = T();
    if (cur && cur.runningSince) cur.lastBeat = Date.now();
    api.saveSync(data);
  });
}

init();
