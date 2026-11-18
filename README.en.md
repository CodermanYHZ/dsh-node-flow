<div align="center">

<img src="./docs/images/banner.png" alt="DSH Node Flow — Visual workflows for DeepSeek Harness" width="100%">

[English](./README.en.md) · [简体中文](./README.md)

### A visual, executable node-based workflow canvas for DeepSeek Harness

Compose triggers, sub-agents, Python code, conditional branches, loops, schedules, and listens with drag-and-drop nodes, then run the complete workflow directly in DSH.

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6.svg)
![React Flow](https://img.shields.io/badge/React%20Flow-12-7c3aed.svg)

</div>

![Node palette and workflow canvas](./docs/images/node-palette.png)

<p align="center"><sub>Add nodes from the left palette and arrange the complete workflow on the canvas</sub></p>

## Overview

DSH Node Flow is a visual workflow plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It combines agent calls, Python scripts, conditions, loops, and scheduled or listened triggers into executable flow diagrams, making it easy to build automation tasks and multi-step agent workflows.

## Features

- **Visual orchestration** — drag nodes, connect handles, and inspect data and execution paths directly on the canvas.
- **Sub-agent calls** — agent nodes can inherit the current model or select a model route configured in DSH.
- **Code nodes (Python)** — run Python on the host, feed it the upstream value and return stdout, with a full-screen code editor.
- **Flow control** — built-in If, Switch, Loop, and While nodes cover branching and iteration.
- **Execution feedback** — nodes display their run state, and the actual path taken is highlighted.
- **Failure policies** — Code and Agent nodes support timeouts, retry count/delay, and either stopping the branch or continuing with an empty value.
- **Scheduled tasks** — save workflows with five-field cron expressions, inspect them in the task board, run them immediately, end, or resume them.
- **Listen triggers** — a listen node keeps a Python process resident and fires one run per stdout line, which suits polling files, queues, or endpoints.
- **Built-in examples** — the workflow library ships example templates; opening one and saving creates your own copy.
- **Import and export** — save workflows as files for backup, sharing, and reuse.
- **Built-in documentation** — the help panel explains the execution model, node fields, connection rules, and complete examples.

## Screenshots

The canvas defines no palette of its own: background, surfaces, text, borders and accent all
come from the host's `--dsw-alias-*` theme tokens, so it matches the shell in both light and
dark and follows a theme change.

### Node properties

Select a node to configure its label, model, prompt, timeout, and failure policy in the right-hand inspector.

![Node properties inspector](./docs/images/node-inspector.png)

### Scheduled tasks and listens

The scheduled-task board displays cron plans, previous trigger times, and latest run results, plus the logs and events of listener processes, with actions to run once, end, resume, or delete a task.

![Scheduled task board](./docs/images/scheduled-tasks.png)

## Quick start

### Compatibility

This version targets **DSH 0.2.x** (`engines.dsh` in `package.json` requires `>=0.2.0-rc.2`). The host half relies on:

| Capability | Uses | Note |
| --- | --- | --- |
| Code nodes | a host Python subprocess (`python -u -c`) | upstream input arrives in `DSH_INPUT`, stdout is the node result; `python → python3 → py` are probed in order |
| Agent nodes | `ctx.subagents.startActivation` | `subagents.start()` was removed; the child's result comes back with `delivery: 'caller'` |
| Model dropdown | `ctx.llm.listProviders()` / `listModels()` | `listProviders()` is synchronous in 0.2.x |
| Sidebar entry and canvas | the `main` + `sidebar.panellist` slots | no shell DOM or class names are read any more (`sidebarCol` / `logoRow` no longer exist) |

The minimum host version is declared in `package.json` under `engines.dsh`.

### Installation

Install from a local directory or from Git until the package is published to npm:

```sh
dsh plugin --profile <profile> add /path/to/dsh-workflow-canvas
dsh plugin --profile <profile> add git+https://github.com/CodermanYHZ/dsh-node-flow.git
```

When running DSH from a DeepSeek Harness source checkout, prefix the command with
`pnpm`, for example `pnpm dsh plugin --profile <profile> add <path>`.

Restart the Web UI after installation (`dsh web`; `pnpm dsh web` for a source checkout).

A **Node Mode** icon appears in the DSH sidebar; clicking it opens the canvas in the
central column.

### Diagnostics

On activation the plugin writes a capability snapshot to
`$DSH_HOME/workflow-canvas/health.json`; `selfTest.ok` records whether a real
**Python** execution succeeded (`selfTest.python` carries the interpreter version) and
`revision` is the loaded plugin build. The same report is served by
`GET /dsh-node-flow/health`. Check it first when a Code node reports a missing Python
interpreter.

### Basic usage

1. Click **Add Node** to pick a node kind; **📂 Workflows** opens your saved workflows and the built-in examples shipped with the plugin.
2. Connect node handles and configure parameters in the right-hand inspector.
3. Click **▶ Run** and watch the node states and highlighted execution path.
4. Use **Export** to save the workflow as a file, or create a cron schedule from **Scheduled Tasks**.

Built-in examples live in the repository's `examples/` directory and ship with the package. They are marked “内置” in the library and are read-only: opening one and pressing **Save** writes a new workflow instead of modifying the file inside the package.

### Execution Workspace and runner session

Agent nodes do not delegate from "whatever agent happens to be live". The **📁 Workspace**
selector in the toolbar decides which Workspace a run belongs to:

- Each Workspace owns one **node-mode runner session**, titled
  `节点模式运行会话 · <workspace>` and listed among that Workspace's sessions.
- The first Agent-node run in a Workspace creates it; later runs reuse it; if it is
  archived or can no longer be revived, the next run creates a fresh one.
- Creation sends one **one-off** bootstrap message (`节点模式运行会话已就绪…`). That is
  not decoration: the sidebar does not render a session that has no messages, and a
  runner session never gains any on its own (children hand their result back to the
  canvas with `delivery: 'caller'`), so without it the row would stay invisible forever.
- Agent nodes execute as children of that session, so they inherit the Workspace's
  directory and sandbox write boundary. That inheritance is the only way to direct a
  child: the host ignores `startActivation`'s `cwd` argument.
- The choice is saved as `executionWorkspaceId` in the workflow document, so export,
  import and scheduled runs all use the same Workspace.

Bindings live in `$DSH_HOME/workflow-canvas/settings.json`; the `runner` section of
`GET /dsh-node-flow/health` reports each Workspace's session id, liveness and visibility.

### Scheduled tasks, listens and run history

A scheduled task does not poll "does the current minute match the cron?". It persists the
**next occurrence** (`nextFireAt`) and a single timer compares that anchor with now:

- The anchor advances and is persisted BEFORE the workflow runs, so a crash costs that one
  run instead of replaying the same occurrence forever.
- An occurrence missed while the host was stopped or the machine asleep is delivered **once**
  on the next wake-up (not N times), then the anchor jumps to the next future time.
- If the previous run of the same task has not settled yet, the new occurrence is skipped and
  logged, so one workflow cannot execute concurrently with itself.
- Cron is matched in the **host's local time zone**; the document's `timezone` field is stored
  but not used yet.
- Every run is stored in `$DSH_HOME/workflow-canvas/runs/<runId>.json` with **its own graph
  snapshot**, each node's status/duration/output/error, and the final output; 30 days and 200
  records are retained, older ones pruned.
- Runs of scheduled tasks and listeners are listed under their own panel entries, where you can
  inspect node details or replay them on the canvas without touching the graph being edited.
- Manual runs are persisted the same way, but they belong to no scheduled task, so they do not
  appear in the task list — read them from `runs/` instead.

### Listen triggers

A listen node keeps a Python process resident; **one stdout line is one event**, and each event
runs the whole flow:

- Lines starting with `[ready]` only record state and never fire.
- Events arriving within `minIntervalMs` (default 500ms) collapse onto the newest one; the queue
  holds at most 5 entries.
- Events run strictly one at a time; if the process exits, the listener turns into an error and
  stops.
- Start, stop, restart or delete it in the Scheduled / Listen board; stopping remembers the
  intent and the host tries to restore it on the next start.

## Companion AI Skill

Install the companion [`dsh-node-flow-skill`](https://github.com/CodermanYHZ/dsh-node-flow-skill) to help AI agents in DSH generate JSON workflows that can be imported directly into this plugin.

The Skill documents the current workflow schema, node fields, connection handles, loop rules, and complete examples, reducing missing fields and invalid handle names. After installation, prompt the AI with:

```text
Use dsh-node-flow-skill to generate an importable dsh-node-flow JSON workflow that …
```

Skill repository: <https://github.com/CodermanYHZ/dsh-node-flow-skill>

## Node types

| Node | Purpose |
| --- | --- |
| **Trigger** | Starts the workflow and passes its content downstream. |
| **Schedule** | Runs the complete workflow using a five-field cron expression. |
| **Listen** | Keeps a Python process resident; one stdout line fires one run. |
| **Agent** | Calls a DSH sub-agent using the inherited model or a selected model route. |
| **Code** | Runs Python on the host, reads upstream input (`DSH_INPUT`) and returns stdout. |
| **If** | Routes the workflow to `true` or `false` based on a truthy condition. |
| **Switch** | Matches a value against cases and falls back to `default`. |
| **Loop** | Iterates over an array or repeats N times, optionally collecting each result. |
| **While** | Repeats while a condition remains true, guarded by `maxIters`. |
| **Output** | Renders the upstream value using a `{{result}}` template. |
| **Note** | Adds a canvas annotation and is not executed. |

## Code node (Python)

Code nodes run on the host as `python -u -c <code>`. The upstream value arrives in the
`DSH_INPUT` environment variable (non-string input is JSON-encoded first), and **stdout, with
surrounding whitespace trimmed, is the node result**:

```python
import json, os

raw = os.environ.get("DSH_INPUT", "")   # output of the upstream node
print(json.dumps({"length": len(raw)}, ensure_ascii=False))
```

- A node fails only when the process exits non-zero or times out; the error text comes from
  stderr (a zero exit ignores stderr entirely).
- The node's `timeout` (seconds) bounds a run; a 600-second hard cap applies on top.
- The legacy `language` field is ignored — everything runs as Python.

Node fields, handle names and expression syntax are documented in the in-app **📖 guide**;
that document is the source of truth.

## Runtime requirements

The plugin expects the DSH host to provide these services:

- `ctx.webServer` for the same-origin routes between canvas and host
- a Python interpreter on the host PATH for Code and Listen nodes (`python → python3 → py`)
- `ctx.agents` and `ctx.subagents` for Agent nodes (via `startActivation`)
- `ctx.llm` for the model-route list behind the Agent node's dropdown

The client half needs the `slots` service (`main` and `sidebar.panellist`) and,
optionally, `layout` for the panel's close action.

React, ReactDOM, and `@deepseek-ai/cordis` are provided by DSH as peer dependencies.

## Local development

```sh
npm install
npm run dev       # Start the standalone Vite preview
npm run build     # TypeScript checks + client bundle + demo build
```

Built-in examples are plain workflow documents in `examples/*.json`: edit one and the change is live, no code regeneration needed. Adding an example means adding a JSON file.

## License

Released under the [MIT License](./LICENSE).
