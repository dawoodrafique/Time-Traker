'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = { minimizeToTray: true, sound: true, backupDir: null, lastTopicId: null };
const BAK_EVERY_MS = 5 * 60 * 1000;

function defaults() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    topics: [
      { id: 'devops', name: 'DevOps', parentId: null, targetMin: 180 },
      { id: 'k8s', name: 'Kubernetes', parentId: 'devops', targetMin: 120 },
      { id: 'linux', name: 'Linux', parentId: 'devops', targetMin: 60 },
    ],
    sessions: [],
    plans: [],
    activeTimer: null,
  };
}

function validate(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.topics) || !Array.isArray(d.sessions)) {
    throw new Error('invalid data');
  }
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    topics: d.topics,
    sessions: d.sessions,
    plans: Array.isArray(d.plans) ? d.plans : [],
    activeTimer: d.activeTimer || null,
  };
}

class Store {
  constructor(dir, fallbackSnapshotDir) {
    this.dir = dir;
    this.file = path.join(dir, 'data.json');
    this.bak = this.file + '.bak';
    this.snapshotDir = fallbackSnapshotDir;
    this.data = null;
    this.lastBak = 0;
  }

  _read(file) {
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  _snapshots() {
    try {
      return fs.readdirSync(this.snapshotDir)
        .filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort().reverse()
        .map((f) => path.join(this.snapshotDir, f));
    } catch { return []; }
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const fresh = !fs.existsSync(this.file);
    const sources = [[this.file, null], [this.bak, 'the automatic backup copy']]
      .concat(this._snapshots().map((f) => [f, 'a daily backup (' + path.basename(f) + ')']));
    for (const [file, label] of sources) {
      if (!fs.existsSync(file)) continue;
      try {
        this.data = this._read(file);
        const notice = label ? 'Your data file was damaged, so it was restored from ' + label + '.' : null;
        return { data: this.data, notice };
      } catch { /* try the next source */ }
    }
    this.data = defaults();
    return { data: this.data, notice: fresh ? null : 'Your data file could not be read, starting fresh.' };
  }

  save(data) {
    this.data = validate(data);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    if (Date.now() - this.lastBak > BAK_EVERY_MS && fs.existsSync(this.file)) {
      try { fs.copyFileSync(this.file, this.bak); this.lastBak = Date.now(); } catch { /* non-fatal */ }
    }
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, validate };
