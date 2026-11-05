# Documentation index

| Document                                                         | Description                                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [current-state.md](./current-state.md)                           | **Canonical reference** — what the app ships today (routes, storage, ingest, AI, normalization)       |
| [roadmap.md](./roadmap.md)                                       | **Canonical forward work** — verified open items only                                                 |
| [ideas.md](./ideas.md)                                           | Broader backlog (code, UI, UX, AI, **ingestion**, **heuristics**) — promote into roadmap when ready   |
| [EVALUATION_MODE.md](./EVALUATION_MODE.md)                       | The evaluation modes: manual, scheduled, and what the heuristic is measured against                   |
| [EVALUATION_AUTOMATION.md](./EVALUATION_AUTOMATION.md)           | The self-running evaluation loop (adjudication, analyst ground truth)                                 |
| [EVALUATION_FULL_AUTOMATION.md](./EVALUATION_FULL_AUTOMATION.md) | Dynamic rules, the sandbox, shadow scoring and auto-correction                                        |
| [normalization.md](./normalization.md)                           | Design spec for the normalization engine (implementation in `src/entities/normalization/`)            |
| [sources_list.md](./sources_list.md)                             | Curated OSINT source ideas and platform notes                                                         |
| [modelbenchmark.md](./modelbenchmark.md)                         | NVIDIA NIM benchmark notes and reproduction scripts                                                   |
| [../README.md](../README.md)                                     | Operator quick start, pipeline narrative, env vars, Postgres                                          |
| [architecture.md](./architecture.md)                             | The reasons, file names and history behind the rules in AGENTS.md, by area                            |
| [../AGENTS.md](../AGENTS.md)                                     | The short rules for contributors and agents; skills in `.claude/skills/` cover the working procedures |
| [archive/README.md](./archive/README.md)                         | Superseded implementation plans and older roadmap rounds                                              |

When README and an older doc disagree, trust **current-state.md** and the code.
