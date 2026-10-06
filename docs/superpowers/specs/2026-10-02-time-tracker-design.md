# Time Tracker — design

Offline, single-user Windows desktop app for tracking study time. Electron, vanilla HTML/CSS/JS, no runtime dependencies, no network access.

## Requirements
- Topics with subtopics (2 levels), each with an optional daily target (e.g. DevOps 3h → Kubernetes 2h + Linux 1h).
- Timer per topic: **Stopwatch** (count up) or **Countdown** (preset/custom duration). Pause/resume, finish & save, discard.
- Each session has a note (what is being studied / learned). Topics have plan items (things to study) with checkboxes.
- Today dashboard: progress vs. target per topic (parents include children), today's sessions.
- History: 14-day chart, streak, week/month/all-time totals, per-day list, manual entry, edit/delete.
- Search across topics, plan items and session notes.
- Backup: data survives app problems (see below).
- Lightweight: single window, hardware acceleration off, no frameworks, optional tray.

## Data
`%APPDATA%\Time Tracker\data.json` — `{topics, sessions, plans, settings, activeTimer}`. Writes are atomic (tmp file + rename) with a rolling `.bak`.
`activeTimer` holds wall-clock timestamps plus a heartbeat (every 15 s and on window unload), so a crash/shutdown loses at most seconds and the timer comes back paused. Sleep pauses the timer.

## Backup (default `Documents\TimeTracker-Backup`, changeable)
After each change (debounced) and on quit: `sessions.csv`, `daily-summary.csv`, `topics.csv`, `plans.csv` (UTF-8 BOM, open in Excel) and a daily JSON snapshot `snapshots/data-YYYY-MM-DD.json` (last 30 kept). If `data.json` is corrupt, load falls back to `.bak`, then the newest snapshot. Settings offers "Restore from backup file".

## Architecture
- `main.js` — window, tray, single-instance, IPC, notifications, backup scheduling.
- `src/store.js` — load/validate/atomic-save. `src/backup.js` — CSV + snapshots.
- `preload.js` — narrow `window.api` bridge (context isolation, sandbox, CSP).
- `src/index.html|style.css|app.js` — UI (Today, Topics, History, Search, Settings).
