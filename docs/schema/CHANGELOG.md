# PennyATS open data format changelog

The compatibility policy is in [README.md](README.md#compatibility-policy).

## 1.1.0

Role presets ([#95](https://github.com/PennyATS/PennyATS/issues/95)).

- `people[].role_key` (optional, open string): the person's role preset, such as `head_of_talent`, `ta_manager`, `recruiter`, `coordinator`, `hiring_manager`, `interviewer`, or `executive`.
- `people[].role` stays one of the original three values. For a preset that 1.0 doesn't know, it holds the closest role with no more access (Head of Talent and TA Manager become `recruiter`; Coordinator, Hiring Manager, and Executive become `interviewer`), so 1.0 readers never grant more access than the source instance did.
- The PennyATS importer uses `role_key` when the instance has that role and falls back to `role`.

## 1.0.0

First published version ([#114](https://github.com/PennyATS/PennyATS/issues/114)).

- Entities: people, jobs (with stages and hiring team), candidates, applications (with stage history events and phone screen notes), interviews, scorecards, and candidate notes.
- Workspace export (`pnpm data:export`, and the admin download on the Privacy page) and import (`pnpm data:import`).
- Not yet included: resume files, email history, the interview plan, scheduling data, notifications, and Google Calendar sync state.
