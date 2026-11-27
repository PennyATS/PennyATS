# PennyATS open data format changelog

The compatibility policy is in [README.md](README.md#compatibility-policy).

## 1.0.0

First published version ([#114](https://github.com/PennyATS/PennyATS/issues/114)).

- Entities: people, jobs (with stages and hiring team), candidates, applications (with stage history events and phone screen notes), interviews, scorecards, and candidate notes.
- Workspace export (`pnpm data:export`, and the admin download on the Privacy page) and import (`pnpm data:import`).
- Not yet included: resume files, email history, the interview plan, scheduling data, notifications, and Google Calendar sync state.
