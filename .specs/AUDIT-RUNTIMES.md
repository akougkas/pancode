# Runtime Adapter Audit

Compiled from code inspection of all 8 runtime adapters.
Source files: `src/engine/runtimes/` and `src/engine/runtimes/adapters/`.
Date: 2026-03-24.

---

## Identity and Classification

| Runtime | ID | Tier | Telemetry | Binary | Version Detection |
|---|---|---|---|---|---|
| Pi | `pi` | native | platinum | (vendored) | Returns `"built-in"` |
| Claude Code | `cli:claude-code` | cli | gold | `claude` | `claude --version` |
| Codex | `cli:codex` | cli | silver | `codex` | `codex --version` |
| Gemini | `cli:gemini` | cli | silver | `gemini` | `gemini --version` |
| opencode | `cli:opencode` | cli | gold | `opencode` | `opencode --version` |
| Copilot CLI | `cli:copilot-cli` | cli | bronze | `copilot` | `copilot --version` |
| Claude SDK | `sdk:claude-code` | sdk | platinum | `claude` | From SDK `init` message |
| Remote SDK | `sdk:remote:{host}` | sdk | gold | (SSH) | SSH `claude --version` |

---

## Usage and Telemetry Extraction

Each cell shows whether the field is reported and how.

| Field | Pi | Claude Code | Codex | Gemini | opencode | Copilot | SDK | Remote SDK |
|---|---|---|---|---|---|---|---|---|
| inputTokens | result file | JSON | NDJSON sum | model stats | NDJSON sum | null | authoritative | NDJSON |
| outputTokens | result file | JSON | NDJSON sum | model stats | NDJSON sum | null | authoritative | NDJSON |
| cacheReadTokens | result file | JSON | null | null | NDJSON | null | authoritative | null |
| cacheWriteTokens | result file | JSON | null | null | NDJSON | null | authoritative | null |
| cost | result file | JSON | NDJSON sum | null | NDJSON sum | null | authoritative | NDJSON |
| turns | result file | `num_turns` | event count | `api_calls` sum | event count | null | `num_turns` | NDJSON |
| model | null | JSON/modelUsage | first event | stats key | step meta | null | init/modelUsage | NDJSON |

---

## RuntimeTaskConfig Field Usage

Each cell shows how the adapter consumes the field.

### task

| Runtime | Method |
|---|---|
| Pi | `--prompt` flag |
| Claude Code | `-p` flag |
| Codex | `exec` positional arg |
| Gemini | `-p` flag |
| opencode | positional arg (must be last) |
| Copilot CLI | `-p` flag |
| SDK | `query({ prompt })` |
| Remote SDK | shim `query({ prompt })` |

### model

| Runtime | Method |
|---|---|
| Pi | Split on `/`: `--provider` + `--model` |
| Claude Code | `--model` |
| Codex | `--model` |
| Gemini | `--model` |
| opencode | `--model` |
| Copilot CLI | `--model` |
| SDK | `options.model` |
| Remote SDK | shim `options.model` |

### systemPrompt

| Runtime | Method |
|---|---|
| Pi | `--system-prompt` flag; if >8000 chars, written to atomic temp file with `@` prefix |
| Claude Code | `--append-system-prompt` (preserves built-in tool descriptions) |
| Codex | Prepended to task text as `[System Instructions]\n...\n\n[Task]\n...` |
| Gemini | Env var `GEMINI_SYSTEM_MD` plus prepended to task text |
| opencode | Prepended to task text |
| Copilot CLI | Prepended to task text |
| SDK | `options.systemPrompt = { type: "preset", preset: "claude_code", append: prompt }` |
| Remote SDK | Shim `options.systemPrompt` with preset append |

### tools

| Runtime | Method |
|---|---|
| Pi | CSV passthrough to `--tools` |
| Claude Code | Mapped to Claude names, passed to `--tools` and `--allowedTools` |
| Codex | Not used |
| Gemini | Mapped to Gemini names, passed to `--allowed-tools` |
| opencode | Not used |
| Copilot CLI | Not used |
| SDK | Mapped to Claude names, set as `options.allowedTools` and `options.tools` |
| Remote SDK | Not used |

### readonly

| Runtime | Method | Reliability |
|---|---|---|
| Pi | No enforcement in adapter | Weak |
| Claude Code | `--tools Read,Grep,Glob` + `--allowedTools Read,Grep,Glob` | Strong |
| Codex | Omits `--full-auto` only; no tool restriction | Weak |
| Gemini | Restricted `--allowed-tools` to read-only set | Strong |
| opencode | Agent selection (`explore` vs `build`) + `OPENCODE_CONFIG_CONTENT` JSON denying edit/bash | Strong |
| Copilot CLI | `--deny-tool write --deny-tool shell` | Strong |
| SDK | `allowedTools=["Read","Grep","Glob"]` + `permissionMode="plan"` | Strong |
| Remote SDK | Always `bypassPermissions`; no enforcement | None |

### runtimeArgs

| Runtime | Method |
|---|---|
| Pi | Not used |
| Claude Code | Passed through to CLI (can override `--max-turns`) |
| Codex | Passed through to CLI |
| Gemini | Passed through to CLI |
| opencode | Filtered passthrough (`--agent` extracted to avoid duplication) |
| Copilot CLI | Passed through to CLI |
| SDK | Parsed for 6 flags: `--max-turns`, `--max-budget`, `--effort`, `--resume`, `--resume-at`, `--sdk-agents` |
| Remote SDK | Parsed for 2 flags: `--max-turns`, `--max-budget` |

### timeoutMs

| Runtime | Method |
|---|---|
| Pi | `--timeout-ms` flag |
| Claude Code | Not used (cli-entry.ts wrapper handles timeout) |
| Codex | Not used (cli-entry.ts wrapper) |
| Gemini | Not used (cli-entry.ts wrapper) |
| opencode | Not used (cli-entry.ts wrapper) |
| Copilot CLI | Not used (cli-entry.ts wrapper) |
| SDK | Via AbortSignal from dispatcher timeout |
| Remote SDK | Process SIGTERM on timeout |

### sampling

| Runtime | Method |
|---|---|
| Pi | 4 env vars: `PANCODE_SAMPLING_TEMPERATURE`, `PANCODE_SAMPLING_TOP_P`, `PANCODE_SAMPLING_TOP_K`, `PANCODE_SAMPLING_PRESENCE_PENALTY` |
| Claude Code | Not used |
| Codex | Not used |
| Gemini | Not used |
| opencode | Not used |
| Copilot CLI | Not used |
| SDK | Not used (SDK does not expose sampling in options) |
| Remote SDK | Not used |

### cwd

| Runtime | Method |
|---|---|
| Pi | Spawn cwd |
| Claude Code | Spawn cwd |
| Codex | `--cd` flag |
| Gemini | Not used (implicit) |
| opencode | `--dir` flag |
| Copilot CLI | Not used |
| SDK | `options.cwd` |
| Remote SDK | Shim `remoteCwd` from host config |

### agentName

| Runtime | Method |
|---|---|
| Pi | Env var `PANCODE_AGENT_NAME` |
| All others | Not used |

### runId

| Runtime | Method |
|---|---|
| Pi | Env var `PANCODE_RUN_ID` |
| All others | Not used |

---

## Session Continuity

| Runtime | sessionMeta Returned | Continuation Args |
|---|---|---|
| Pi | None | N/A |
| Claude Code | `{ sessionId }` | `--resume <sessionId>` |
| Codex | None | N/A |
| Gemini | None | N/A |
| opencode | `{ sessionId }` | `--continue --session <sessionId>` |
| Copilot CLI | None | N/A |
| SDK | `{ sessionId }` | `--resume <sessionId>` (also supports `--resume-at <uuid>`) |
| Remote SDK | `{ sessionId }` | N/A (session lives on remote host) |

---

## Tool Name Mapping

Each runtime that maps PanCode tool names to runtime-specific names.

| PanCode | Pi | Claude Code / SDK | Gemini | Copilot (deny) |
|---|---|---|---|---|
| `read` | passthrough | `Read` | `ReadFile` | (allowed) |
| `write` | passthrough | `Write` | `WriteFile` | denied |
| `edit` | passthrough | `Edit` | `EditFile` | (allowed) |
| `bash` | passthrough | `Bash` | `ShellTool` | denied |
| `grep` | passthrough | `Grep` | `SearchFile` | (allowed) |
| `find` | passthrough | `Glob` | `ListDirectory` | (allowed) |
| `ls` | passthrough | `Glob` | `ListDirectory` | (allowed) |

Codex and opencode do not map or restrict tools at the adapter level.

---

## Environment Variables Set by Each Runtime

| Runtime | Variables |
|---|---|
| Pi | `PANCODE_SAMPLING_TEMPERATURE`, `PANCODE_SAMPLING_TOP_P`, `PANCODE_SAMPLING_TOP_K`, `PANCODE_SAMPLING_PRESENCE_PENALTY`, `PANCODE_RUN_ID`, `PANCODE_PARENT_PID`, `PANCODE_SAFETY`, `PANCODE_BOARD_FILE`, `PANCODE_CONTEXT_FILE`, `PANCODE_AGENT_NAME`, `PANCODE_DISPATCH_DEPTH`, `PANCODE_DISPATCH_MAX_DEPTH`, `PI_CODING_AGENT_DIR`, `PI_SKIP_VERSION_CHECK` |
| Claude Code | `PANCODE_DISPATCH_DEPTH`, `PANCODE_DISPATCH_MAX_DEPTH` |
| Codex | `PANCODE_DISPATCH_DEPTH`, `PANCODE_DISPATCH_MAX_DEPTH` |
| Gemini | `GEMINI_SYSTEM_MD`, `GEMINI_SANDBOX`, `PANCODE_DISPATCH_DEPTH`, `PANCODE_DISPATCH_MAX_DEPTH` |
| opencode | `OPENCODE_CONFIG_CONTENT`, `PANCODE_DISPATCH_DEPTH`, `PANCODE_DISPATCH_MAX_DEPTH` |
| Copilot CLI | `PANCODE_DISPATCH_DEPTH`, `PANCODE_DISPATCH_MAX_DEPTH` |
| SDK | `CLAUDE_AGENT_SDK_CLIENT_APP` (inside SDK env option) |
| Remote SDK | `CLAUDE_AGENT_SDK_CLIENT_APP` (inside remote shim) |

---

## Output Format and Parsing Strategy

| Runtime | outputFormat | Parsing |
|---|---|---|
| Pi | `ndjson` | Per-line JSON plus separate result file (authoritative) |
| Claude Code | `json` | 4-format fallback: JSON array, single object, NDJSON, brace extraction |
| Codex | `json` | NDJSON lines with BOM stripping and brace fallback |
| Gemini | `json` | JSON object with model/tool stats aggregation |
| opencode | `json` | NDJSON events: `text`, `step_finish`, `session.error` |
| Copilot CLI | `text` | Raw stdout trimmed |
| SDK | N/A | Typed async generator (SDKMessage union, 22+ message types) |
| Remote SDK | N/A | SSH stdout parsed as NDJSON |

---

## Features Unique to Specific Runtimes

| Feature | Runtime(s) |
|---|---|
| NDJSON streaming with live progress | Pi, Codex, opencode |
| Real-time async iterator streaming | SDK |
| Tool interception (`canUseTool` callback) | SDK |
| Subagent definitions (`--sdk-agents` JSON) | SDK |
| Agent progress summaries (`agentProgressSummaries`) | SDK |
| Effort level control (`--effort low/medium/high/max`) | SDK |
| Budget cap (`--max-budget`) | SDK |
| Thinking delta streaming (extended thinking models) | SDK |
| Daemon attachment (port probe) | opencode (`localhost:4096`) |
| Sandbox mode | Gemini (`GEMINI_SANDBOX`), SDK (sandbox option) |
| Recursion depth guard | Pi (`PANCODE_DISPATCH_DEPTH`) |
| Long prompt temp file (>8000 chars) | Pi |
| Separate result file (JSON) | Pi (`worker-*.result.json`) |
| Remote SSH execution | Remote SDK |
| Node selection (memory/GPU/labels) | Remote SDK |
| Remote health check | Remote SDK |
| Concurrency limiter | SDK path (`SdkConcurrencyLimiter`) |
| Session pool with cost tracking | SDK path (`SdkSessionPool`) |
| BOM stripping for malformed output | Codex |
| v2.x JSON array format handling | Claude Code |
| Permission denial via runtime config | opencode (`OPENCODE_CONFIG_CONTENT`) |

---

## Gaps and Inconsistencies

### Sampling support

Only Pi reads `config.sampling`. All other runtimes ignore it. Sampling parameters (temperature, top_p, top_k, presence_penalty) are only effective when dispatching through the Pi native runtime with a local model.

### System prompt delivery

Three distinct patterns exist with no unified approach:
1. Native flag (`--system-prompt`, `--append-system-prompt`, `options.systemPrompt`)
2. Prepend to task text (Codex, opencode, Copilot)
3. Environment variable (`GEMINI_SYSTEM_MD`)

Prepending to task text conflates instructions with the task itself. The model cannot distinguish system-level instructions from user content.

### Readonly enforcement

Three runtimes have weak or no readonly enforcement:
- Pi: no adapter-level check
- Codex: no tool restriction, only omits `--full-auto`
- Remote SDK: always runs in bypass mode

### Tool mapping coverage

Codex and opencode accept no tool restrictions from PanCode. Dispatching a tool-restricted agent to these runtimes silently ignores the restriction.

### Cache token reporting

Only 4 of 8 runtimes report cache tokens (Pi, Claude Code, opencode, SDK). The remaining 4 return null. Aggregation code must handle null gracefully.

### Cost reporting

Gemini and Copilot never report cost. All cost displays for these runtimes show dashes.

### Model reporting

Pi never reports the model used. The dispatch layer infers the model from routing, but the result does not confirm it.

### Session continuity

4 of 8 runtimes support session continuity (Claude Code, opencode, SDK, Remote SDK). The remaining 4 (Pi, Codex, Gemini, Copilot) are stateless per execution. Every dispatch to a stateless runtime starts a fresh conversation.

### Dispatch depth tracking

All CLI runtimes set `PANCODE_DISPATCH_DEPTH` and `PANCODE_DISPATCH_MAX_DEPTH`, but only Pi actually reads and enforces the depth limit. CLI runtimes propagate the env vars for the cli-entry.ts wrapper, but the underlying tools (claude, codex, gemini, etc.) ignore them.

### agentName and runId propagation

Only Pi passes `agentName` and `runId` to the worker process. No CLI or SDK runtime makes these identifiers available to the executing agent.
