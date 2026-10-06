# Time Tracker

Offline desktop study-time tracker (Electron, no network access, no runtime dependencies).

- **Install:** run `dist\Time Tracker Setup 1.0.0.exe`.
- **Data:** `%APPDATA%\time-tracker\data.json` (atomic writes + `.bak`).
- **Backup:** `Documents\TimeTracker-Backup` — `sessions.csv`, `daily-summary.csv`, `topics.csv`, `plans.csv` (open in Excel) and `snapshots\data-YYYY-MM-DD.json` (last 30 days). Restore from Settings.

## Develop
```
npm install
npm start          # run
npm run dist       # build installer into dist/
```
Design notes: `docs/superpowers/specs/2026-10-02-time-tracker-design.md`.
