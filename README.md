# openCodex

openCodex is an open-source coding agent project inspired by openclaw.

The goal of this repository is to explore a practical, repo-aware coding workflow that can:

- understand a task,
- inspect project context,
- propose an execution plan,
- apply targeted changes,
- verify results with focused validation.

## Language Policy

- Project-facing content stays in English.
- Bilingual documentation lives under `docs/en` and `docs/zh`.
- Discussion with the maintainer can happen in Chinese, while repository artifacts remain English-first.

## Initial Scope

The first milestone focuses on a small but useful CLI-first experience:

- task intake,
- lightweight planning,
- repository search and context collection,
- safe file patching,
- command execution,
- validation hooks.

## Repository Layout

```text
openCodex/
├── docs/
│   ├── en/
│   └── zh/
├── src/
├── tests/
└── README.md
```

## Documentation

- English docs index: `docs/en/README.md`
- Chinese docs index: `docs/zh/README.md`

## Status

This repository is currently in the project-definition stage.
The current version establishes naming, structure, and documentation conventions for the first implementation pass.

