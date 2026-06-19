# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Python setup
uv sync --extra dev

# Run tests (fast, no special hardware)
uv run pytest tests/ -v
# Run a single test file
uv run pytest tests/path/to/test_file.py -v
# Skip tests requiring hardware/cloud/live services
uv run pytest tests/ -v -m "not cloud and not live and not nvidia and not apple and not slow"

# Lint and format
uv run ruff check src/ tests/
uv run ruff format src/ tests/

# Type checking
uv run ty check

# Build the Rust extension (required for full functionality)
cd rust && maturin develop

# Frontend (chat UI)
cd frontend && npm install && npm run dev
# Frontend lint
cd frontend && npx @biomejs/biome lint src/
# Frontend type-check
cd frontend && npm run build   # tsc -b runs as part of build

# Desktop (Tauri)
cd frontend && npm run tauri dev

# Pre-commit hooks (run automatically on commit after install)
uv run pre-commit install
```

## Architecture

OpenJarvis is a **local-first personal AI framework** composed of three layers:

1. **Python core** (`src/openjarvis/`) - agents, engines, tools, channels, evaluations
2. **Rust extension** (`rust/`) - performance-critical primitives (retrieval, telemetry, security scanning, learning, sessions) compiled via PyO3 into `openjarvis_rust`
3. **Frontend** (`frontend/`) - React 19 + Vite chat UI; ships as both a browser SPA (served by the Python backend) and a Tauri desktop app (`desktop/`)

### Python / Rust boundary

`src/openjarvis/_rust_bridge.py` is the **single import point** for `openjarvis_rust`. All Python modules that need Rust functionality import helpers from there — never directly. `RUST_AVAILABLE` flag controls Python fallback paths where they exist.

### Registry pattern

New components must register themselves via the typed subclasses in `src/openjarvis/core/registry.py`:

| Registry | Use for |
|---|---|
| `EngineRegistry` | Inference engine backends |
| `AgentRegistry` | Agent implementations |
| `ToolRegistry` | Tool specifications |
| `ChannelRegistry` | Communication channels (Telegram, Discord, etc.) |
| `ConnectorRegistry` | Data-source connectors (Gmail, Drive, etc.) |
| `MinerRegistry` | Pearl mining providers |
| `MemoryRegistry` | Memory/retrieval backends |
| `SkillRegistry` | Skill manifests |

Mining providers also need an idempotent `ensure_registered()` (used by the autouse-clear test fixture).

### Event bus

Inter-primitive communication uses `EventBus` from `src/openjarvis/core/events.py`. New lifecycle events should publish via `get_event_bus()` using types from `EventType`.

### Inference engines (`src/openjarvis/engine/`)

Backends: `ollama`, `cloud` (OpenAI/Anthropic/Gemini), `litellm`, `apple_fm_shim` (Apple Foundation Models), `nexa_shim`, `gemma_cpp`, `multi` (router). Engine discovery is automatic via `_discovery.py`. All engines implement the `InferenceEngine` stub from `_stubs.py`.

### Agents (`src/openjarvis/agents/`)

Key implementations: `executor` (tool-calling loop), `native_react` (ReAct), `deep_research` (multi-hop with citations), `morning_digest`, `monitor_operative`, `opencode` (code agent), `channel_agent` (wraps any agent for channel delivery). The `manager.py` handles lifecycle (create, pause, resume, schedule).

### Tools (`src/openjarvis/tools/`)

Includes file I/O, browser, shell, code interpreter (local and Docker), digest collection, audio, database query, and approval store. Storage backends live in `tools/storage/`.

### Channels (`src/openjarvis/channels/`)

WhatsApp (Baileys bridge - Node.js subprocess), Telegram, Discord, iMessage, Email, Matrix, Slack, and more. Each registers via `ChannelRegistry`.

### Pearl mining (`src/openjarvis/mining/`)

Background inference-on-idle system: `vllm_pearl` (NVIDIA), `apple_mps_pearl`, `cpu_pearl`. Providers register via `MinerRegistry`.

### Frontend structure

- `frontend/src/pages/` - route-level views (Chat, Settings, DataSources, Agents, Logs)
- `frontend/src/components/` - shared UI (Chat/, Desktop/, setup/)
- `frontend/src/lib/` - API client (`api.ts`), rehype plugins
- `frontend/src/types/` - TypeScript types

The frontend communicates with the Python backend via the OpenAI-compatible server in `src/openjarvis/server/`.

## Test conventions

Tests live in `tests/` mirroring the `src/` structure. Pytest markers (`cloud`, `live`, `nvidia`, `apple`, `slow`, `hub`, `docker`) gate tests that need real hardware or credentials - omit `-m` filtering to run all, or use `-m "not cloud and not live"` for a fast local pass.

Mining provider tests use an autouse fixture that calls `MinerRegistry.clear()` before each test and expects each provider module to expose `ensure_registered()`.

## Code style notes

- Ruff handles formatting and linting automatically (pre-commit + CI). Line-length exceptions for long prompt strings are already configured for `evals/`, `agents/hybrid/`, `agents/research_loop.py`, `examples/`, and `tools/`.
- Python ≥3.10 required; no 3.14 (no prebuilt numpy wheels).
- Rust workspace MSRV is 1.88 (let-chains and `is_multiple_of` require it).
- Frontend uses Biome for lint (`noExplicitAny`, `noArrayIndexKey`, a11y rules) and TypeScript strict mode.

## Cleanup needed

Three temp files in the project root from a type-checking session should be removed when convenient: `analyze_ty.py`, `fix_type_ignores.py`, `ty_output.txt`.
