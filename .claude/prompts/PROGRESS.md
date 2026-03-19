# PanCode Build Progress

## v0.1.9: pancode.dev Website Build (COMPLETE, 2026-03-19)

114 TypeScript source files. Commit `e9e3685`. Integration test infrastructure
for building pancode.dev with PanCode agents. Interactive test ready to run.

### What shipped in v0.1.9

- templates/integration-test.sh: automated project scaffolding and test setup
- Integration test documents full mode lifecycle: capture, plan, build, review
- Success criteria: renders correctly, multiple agents contribute, no crashes, /doctor passes
- Ready for manual execution with real local models

---

## v0.1.8: Integration Test Prep (COMPLETE, 2026-03-19)

114 TypeScript source files. Commit `5c50475`. Web development agent templates
and full pipeline verification for integration test readiness.

### What shipped in v0.1.8

- templates/web-dev-agents.yaml: 6 specialized agents (dev, architect, designer, qa, reviewer, scout) with web-focused system prompts
- All agents portable via PANCODE_WORKER_MODEL env var
- Full pipeline verification: typecheck + boundaries + build all pass
- 114 TypeScript source files across 8 domains

---

## v0.1.7: Tail + Portability (COMPLETE, 2026-03-19)

115 TypeScript source files. Commit `96b94b4`. Skills discovery, cluster
visibility, portability cleanup (no hardcoded IPs in source).

### What shipped in v0.1.7

- agents/skills.ts: SKILL.md discovery from 4 standard directories, frontmatter parsing, tool validation
- /skills command: list/show/validate subcommands for skill inspection
- scheduling/cluster-transport.ts: node-centric cluster view grouped by host
- /cluster command: display discovered engines with model counts and health status
- Portability: removed hardcoded IPs, moved node aliases to PANCODE_CLUSTER_ALIASES env var
- Barrel exports for SkillDefinition, ClusterNode, ClusterEngine types

---

## v0.1.6: Observability + Resilience (COMPLETE, 2026-03-19)

113 TypeScript source files. Commit `4a89caf`. Structured audit trail, 8-probe
health diagnostics, per-provider backoff, and provider resilience tracking.

### What shipped in v0.1.6

- dispatch/backoff.ts: exponential backoff with jitter, circuit breaker (3 failures), 429 support
- dispatch/resilience.ts: sliding window (10 attempts) provider health tracking (healthy >=70%, degraded 30-70%, unhealthy <30%)
- observability/telemetry.ts: in-memory ring buffer audit trail (1000 entries), domain/severity filtering
- observability/health.ts: 8-probe diagnostic checklist (runtime dir, orphan workers, stale runs, provider health, board.json, context.json, session size, budget)
- /audit command: structured table with TIME/SEV/DOMAIN/EVENT/DETAIL, filterable by domain or severity
- /doctor command: pass/warn/fail health report, gathers inputs from dispatch and scheduling domains via dynamic import
- Audit trail auto-records session_start, run-finished, warnings, session-reset, compaction events

---

## v0.1.5: Shadow Agents (COMPLETE, 2026-03-19)

109 TypeScript source files. Commit `ddd6ae0`. Shadow explore tool for
orchestrator-internal codebase intelligence using in-process Pi agent sessions.

### What shipped in v0.1.5

- engine/shadow.ts: lightweight in-process Pi agent session wrapper (SessionManager.inMemory, readonly tools, configurable model)
- agents/shadow-explore.ts: shadow_explore tool with model resolution (PANCODE_SHADOW_MODEL env, fallback to orchestrator model)
- Tool registered via agents domain extension, visible in orchestrator tool list
- In-process execution avoids subprocess overhead for quick exploration queries
- 30-second timeout, tool call counting, structured error handling

---

## v0.1.4: Dispatch Depth (COMPLETE, 2026-03-19)

107 TypeScript source files. Commit `37c5d08`. Chain dispatch with output
contracts, three dispatch commands, and full dispatch analytics.

### What shipped in v0.1.4

- validation.ts: post-dispatch output contracts (expectedFiles, expectedPatterns, validationCommand)
- dispatchChain(): sequential pipeline primitive with $INPUT/$ORIGINAL token substitution, max 8000 char output cap
- dispatch_chain tool: multi-step agent workflows with per-step validation
- /stoprun: cancel running dispatch by ID prefix, kill worker process, mark as cancelled
- /cost: per-run cost breakdown grouped by agent and model, table format
- /dispatch-insights: agent analytics (runs, ok, errored, error rate, avg time), last 5 dispatches, active dispatch rules
- Barrel exports for validation types (OutputContract, ValidationResult) and chain types (ChainStep, ChainResult)

---

## v0.1.3: Coordination + Session (COMPLETE, 2026-03-19)

106 TypeScript source files. Commit `214aa25`. Worker coordination surface
with enhanced session commands, board sync after dispatch, and agent identity.

### What shipped in v0.1.3

- Enhanced /context: table format with KEY/SOURCE/TIMESTAMP/VALUE columns, key-based full value lookup, source filtering
- Enhanced /reset: three subcommands (quick reset, reset context with confirmation, reset all with confirmation), entry count reporting
- Enhanced /checkpoint: list subcommand reads pancode-checkpoint entries from Pi session, shows context/board counts; restore subcommand is display-only stub
- Board sync after worker dispatch (pancode:run-finished listener) and on session_start (picks up previous session entries)
- agentName passed through spawnWorker and runParallel for worker identity in board/context writes
- Checkpoint data enriched with contextEntries, boardEntries, temporalMemory, persistentMemory, budgetSpent

---

## v0.1.2: Command Surface (COMPLETE, 2026-03-19)

106 TypeScript source files. Commit `2bbcc68`. Full command surface takeover
with categorized /help, Pi native wrapping, and /settings redesign.

### What shipped in v0.1.2

- All 18 Pi native commands hidden from autocomplete and help listing
- Prototype method patching for /new (reset event), /compact (compaction event), /reload (reload event), /session (PanCode wrapper)
- Categorized /help: 36 commands across 7 categories (SESSION, DISPATCH, AGENTS, OBSERVE, SCHEDULE, DISPLAY, UTILITY)
- Session domain commands: /session (Pi info + PanCode state), /checkpoint, /context, /reset
- /settings redesign: 8 configurable knobs (safety, orchestrator model, worker model, reasoning, theme, budget, domains, intelligence)
- Dispatch domain listens for pancode:session-reset to clear task store on /new
- PanCodeSettings extended with safetyMode, workerModel, budgetCeiling, intelligence
- Stub entries for future commands (/stoprun, /cost, /dispatch-insights, /skills, /audit, /doctor, /cluster)

---

## v0.1.1: Modes + Tasks (COMPLETE, 2026-03-19)

106 TypeScript source files. Commit `10fb841`. 5 orchestrator behavior modes
with Shift+Tab cycling, 4 task tools, mode gating on dispatch, architectural
rules in system prompt.

### What shipped in v0.1.1

- 5 orchestrator behavior modes: capture (blue), plan (purple), build (green), ask (orange), review (red)
- Shift+Tab cycling through modes with footer indicator
- /mode command to switch or view modes
- task_write, task_check, task_update, task_list tools (persisted to tasks.json)
- Hard mode gating: dispatch blocked in capture/plan, readonly-only in ask/review
- Architectural rules injected into every mode's system prompt
- Mode-specific orchestrator instructions per mode

### Lessons encoded from v0.1.0 real-world test

- Local model (Qwen 35B distilled) modified vendored Pi SDK packages (boundary violation)
- Orchestrator dispatched dev workers when user asked for scouts (mode enforcement needed)
- Scout workers returned identical generic responses for different tasks (prompt specificity)
- Mode instructions now include hard architectural rules (never modify packages/, etc.)

---

## v0.1.0: Foundation Release (COMPLETE, 2026-03-19)

104 TypeScript source files. 8 domains. Full build pipeline. Smoke test 8/8 PASS.
Tagged v0.1.0. Pushed to GitHub as orphan branch (clean history).

### What shipped

- 8 composable domains: safety, agents, dispatch, session, observability, scheduling, intelligence, ui
- Engine boundary (src/engine/) as sole Pi SDK import surface, enforced at build time
- Subprocess dispatch with worker isolation (src/worker/ separate from src/domains/)
- Provider-agnostic local engines (LM Studio, Ollama, llama.cpp) via native SDKs
- YAML-driven agent loading, model knowledge base with capability matching
- Session coordination substrate (context registry, shared board, 3-tier memory)
- Two-layer safety (formal 4-level/10-class scope model + YAML rules)
- Loop detector with cascade detection
- Live dispatch board (worker cards, agent stats, telemetry, context tracking)
- PanCode dark/light themes (amber accent, custom color palette)
- Worker safety extension loaded via Pi --extension flag
- Hybrid worker launch (entry.ts wraps pi with safety extension)
- Multi-phase shutdown coordinator
- Full npm build pipeline (4 Pi SDK packages + tsup)
- 14 slash commands, CLI fast paths (--help, --version)
- CI + Release GitHub workflows

### Verified

- Typecheck + boundaries pass
- Build pipeline (npm run build) produces dist/ in 111ms
- Compiled output boots TUI and dispatches workers
- Fresh boot with zero state: all domains load, board initializes empty
- All 14 slash commands work without crash
- Single dispatch (scout): worker spawns, completes, board updates
- Batch dispatch (2 concurrent): both complete, board shows both
- Error handling: unknown agent produces clear error, no crash
- Clean exit: no orphan processes

## Version Roadmap: v0.1.1 through v0.1.9

| Version | Focus | Prompt File |
|---------|-------|-------------|
| v0.1.1 | Modes + Tasks | v0.1.1-modes-tasks.md |
| v0.1.2 | Command Surface | v0.1.2-command-surface.md |
| v0.1.3 | Coordination + Session | v0.1.3-coordination-session.md |
| v0.1.4 | Dispatch Depth | v0.1.4-dispatch-depth.md |
| v0.1.5 | Shadow Agents | v0.1.5-shadow-agents.md |
| v0.1.6 | Observability + Resilience | v0.1.6-observability-resilience.md |
| v0.1.7 | Tail + Portability | v0.1.7-tail-portability.md |
| v0.1.8 | Integration Test Prep | v0.1.8-integration-test-prep.md |
| v0.1.9 | pancode.dev Website Build | v0.1.9-pancode-dev-build.md |

## Locked Decisions (All Sessions)

1. Subprocess dispatch is final. Workers are pi subprocesses.
2. Vendor Pi SDK as @pancode/pi-* workspace packages.
3. Declarative dispatch rules default, intelligence as upgrade path.
4. Session continuity via Pi SDK sessions + independent domain persistence.
5. 8 domains for v1.0.
6. Orchestrator on mini (141), workers on dynamo (143).
7. Worktree isolation scaffolded in v1.0, full lifecycle post-v1.0.
8. Provider agnostic, local engine SDKs.
9. No test theater, inline verification only.
10. Pure open source (Apache 2.0).
11. Worker launch: hybrid (entry.ts wraps pi with --extensions).
12. Scope model: both layers (formal model + YAML rules). Block/allow only. Ask deferred.
13. Drop /clear. /reset for coordination state. Pi /new for full session reset.
14. Board IPC: file-backed. Workers read/write same JSON files via safety extension.
15. Checkpoint: lightweight Pi appendCustomEntry marker.
16. Retry policy: per-agent retryPolicy in agents.yaml.
17. Command UX: own full surface, ~30 commands, categorized /help, power-user-first.
18. Cluster depth: discovery + visibility only.
19. Portability: graceful degradation, model:null defaults, no hardcoded IPs.
20. Doctor depth: diagnostic checklist, 8 probes, <2s.
21. Context registry: file-backed, worker tools via safety extension.
22. Shadow agents: orchestrator-internal tools for pre-dispatch intelligence. Not dispatch.
23. Five orchestrator modes: capture (blue), plan (purple), build (green), ask (orange), review (red).
24. Tasks: mastracode-style tool calls (task_write, task_check). LLM-driven, no enforcement.
25. npm packaging: tsup bundle, Pi SDK packages compiled via tsc.

## Spec vs Reality (v0.1.0)

The spec (extension-architecture-spec.md) was written before the build.
Some Phase B items shipped in v0.1.0, some spec items are not yet built.

Already shipped (ahead of spec Phase B):
- session/context-registry.ts, shared-board.ts, memory.ts (spec said Phase B)
- safety/scope-enforcement.ts, loop-detector.ts, yaml-rules.ts (spec said Phase B)
- Worker safety extension via --extensions flag (spec said Phase B)
- Live dispatch board with telemetry (not in spec at all, new feature)
- PanCode themes (not in spec, new feature)
- Full build pipeline with tsup + tsc (not in spec)

Not yet built (spec says Phase B):
- Session tools: report_context, read_context, board_write, board_read (worker uses file IPC instead)
- Session commands: /checkpoint, /context, /reset
- Dispatch commands: /stoprun, /cost, /dispatch-insights
- Dispatch primitives: chain dispatch with $INPUT/$ORIGINAL
- Dispatch: validation.ts (output contracts), backoff.ts, resilience.ts
- Agents: skills.ts, /skills command
- Scheduling: cluster-transport.ts, /cluster command
- Observability: telemetry.ts (structured audit), /audit, /doctor commands

Not in spec but decided this session:
- 5 orchestrator behavior modes (capture/plan/build/ask/review)
- Task tools (task_write, task_check, task_update, task_list)
- Shadow agents (orchestrator-internal exploration tools)
- Full command surface takeover (~30 PanCode commands wrapping Pi native)
- Categorized /help by domain

## Known Issues (Backlog)

1. runs.json and metrics.json grow unbounded (no max entries, no TTL)
2. No session boundary markers in any ledger
3. Pi SDK session JSONL files grow unbounded
4. /models shows embedding models in per-provider view

## Reference Documents

- Architecture spec: .specs/extension-architecture-spec.md
- Dispatch IP inventory: .specs/DISPATCH-ARCHITECTURE.md
- Old codebase reference: __NUKED/src/
- Competitive analysis: __NUKED/.planning/competitive-parity/
- Positioning: __NUKED/.planning/__pre-refactor-plans/positioning.md
