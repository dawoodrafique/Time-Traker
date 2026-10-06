'use strict';
const fs = require('fs');
const path = require('path');

const KEEP_SNAPSHOTS = 30;

function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]/.test(s) || /^-\S/.test(s)) s = "'" + s; // keep Excel from treating text as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv(file, rows) {
  fs.writeFileSync(file, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
}

function topicPath(topics, id, fallback) {
  const parts = [];
  let t = topics.find((x) => x.id === id);
  if (!t) return fallback || '(deleted topic)';
  for (let i = 0; t && i < 10; i++) {
    parts.unshift(t.name);
    t = t.parentId ? topics.find((x) => x.id === t.parentId) : null;
  }
  return parts.join(' / ');
}

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function runBackup(data, dir) {
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
  const { topics, sessions, plans } = data;
  const errors = [];
  const files = [];
  const attempt = (name, fn) => {
    try { fn(); files.push(name); } catch (e) { errors.push(name + ': ' + e.message); }
  };
  const ordered = [...sessions].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  attempt('sessions.csv', () => writeCsv(path.join(dir, 'sessions.csv'),
    [['Date', 'Start time', 'Topic', 'Minutes', 'Duration (h:mm:ss)', 'Mode', 'Note']].concat(
      ordered.map((s) => {
        const sec = s.seconds || 0;
        const time = s.mode === 'manual' ? '' : new Date(s.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const dur = `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
        return [s.date, time, topicPath(topics, s.topicId, s.path), Math.round(sec / 60 * 10) / 10, dur, s.mode, s.note];
      }))));

  attempt('daily-summary.csv', () => {
    const sums = new Map();
    for (const s of sessions) {
      const key = s.date + '\u0000' + topicPath(topics, s.topicId, s.path);
      sums.set(key, (sums.get(key) || 0) + (s.seconds || 0));
    }
    const rows = [...sums.entries()].sort().map(([k, sec]) => {
      const [date, name] = k.split('\u0000');
      return [date, name, Math.round(sec / 60 * 10) / 10];
    });
    writeCsv(path.join(dir, 'daily-summary.csv'), [['Date', 'Topic', 'Minutes']].concat(rows));
  });

  attempt('topics.csv', () => writeCsv(path.join(dir, 'topics.csv'),
    [['Topic', 'Daily target (minutes)']].concat(topics.map((t) => [topicPath(topics, t.id), t.targetMin || 0]))));

  attempt('plans.csv', () => writeCsv(path.join(dir, 'plans.csv'),
    [['Topic', 'Item', 'Done', 'Created']].concat(
      plans.map((p) => [topicPath(topics, p.topicId), p.text, p.done ? 'yes' : 'no', p.created || '']))));

  attempt('snapshot', () => {
    const snapDir = path.join(dir, 'snapshots');
    fs.writeFileSync(path.join(snapDir, `data-${localDate()}.json`), JSON.stringify({ ...data, activeTimer: null }, null, 1));
    const old = fs.readdirSync(snapDir).filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(KEEP_SNAPSHOTS);
    for (const f of old) fs.unlinkSync(path.join(snapDir, f));
  });

  return { dir, files, errors };
}

module.exports = { runBackup };
