# PanCode Repository State Audit

**Captured:** 2026-04-16  
**Branch:** `main` @ `94009a7`  
**Version:** 0.3.0 (no tag yet)

---

## 1. Repository Identity

| Field | Value |
|-------|-------|
| Name | `akougkas/pancode` |
| Remote | `https://github.com/akougkas/pancode.git` |
| License | Apache 2.0 |
| Description | Composable multi-agent runtime for software engineering |
| Created | 2026-03-19 |
| Age | 28 days (7 days of active development, then stabilization) |
| Author | Anthony Kougkas (sole contributor) |

---

## 2. Timeline and Velocity

### Version History

| Version | Commit | Date | Significance |
|---------|--------|------|-------------|
| v0.1.0 | `d6b5180` | 2026-03-19 | Foundation release. First commit. |
| v0.1.1-v0.1.9 | various | 2026-03-19 | Rapid iteration: modes, commands, workers, dispatch, audit trail, skills, templates |
| v0.2.0 | `230b947` | 2026-03-19 | Universal Agent Control Plane. Tagged + released on GitHub. |
| v0.2.1-v0.2.3 | various | 2026-03-19-20 | Telemetry, cost tracking, bounded state |
| v0.3.0 | `6726e1d` | 2026-03-23 | Multi-agent dispatch, TUI redesign, constitutional prompting |
| Current | `94009a7` | 2026-03-25 | Latest commit on local main. Env var forwarding fix. |

All three major versions landed within 7 days. The codebase went from zero to ~30K LOC in one week.

**Prior life:** Archive branches and stash entries reference versions up to v0.7.6, indicating PanCode existed in a prior incarnation before a clean-room rebuild on 2026-03-19. The current `main` is an entirely fresh lineage.

### Commits Per Day (main branch)

| Date | Commits |
|------|--------:|
| 2026-03-24 | 42 |
| 2026-03-25 | 29 |
| 2026-03-19 | 23 |
| 2026-03-21 | 22 |
| 2026-03-23 | 18 |
| 2026-03-20 | 13 |
| 2026-03-22 | 2 |
| **Total** | **149** |

### Commit Volume

| Scope | Count |
|-------|------:|
| Commits on main | 149 |
| Commits across all branches | 649 |
| Peak day (main) | 42 (March 24) |
| Average per day (main) | ~21 |

---

## 3. Commit Analysis

### By Type (Conventional Commits, all branches)

| Type | Count | Share |
|------|------:|------:|
| feat | 284 | 44% |
| fix | 151 | 23% |
| docs | 71 | 11% |
| chore | 55 | 8% |
| refactor | 50 | 8% |
| test | 15 | 2% |
| perf | 2 | <1% |
| style | 1 | <1% |

### By Scope (top 15, all branches)

| Scope | Count |
|-------|------:|
| core | 109 |
| ui | 58 |
| dispatch | 51 |
| cli | 32 |
| agents | 13 |
| providers | 12 |
| website | 10 |
| runtimes | 10 |
| safety | 7 |
| engine | 7 |
| deps | 7 |
| prompts | 6 |
| session | 5 |

### Contributors

| Author | Commits |
|--------|--------:|
| akougkas | 621 |
| Anthony Kougkas | 27 |
| Claude | 1 |

Single-author project. The two akougkas entries reflect different git configs (same person). The Claude commit is a blog post on a dedicated branch.

---

## 4. Branch Inventory

### Active Branches (3)

| Branch | Commit | Relationship to main |
|--------|--------|---------------------|
| **`main`** | `94009a7` | Current. 1 commit behind `origin/main`. |
| `sprint/future-experimental` | `4ac7c03` | 64 ahead, 89 behind main. Unmerged feature work (command surface audit). |
| `sprint/future-experimental-beta` | `bf1eccb` | 40 ahead, 89 behind main. Unmerged feature work (ARC memory with TF-IDF). |

### Merged Sprint Branches (2)

| Branch | Commit | Status |
|--------|--------|--------|
| `sprint/bugfix-safety` | `706d802` | Fully merged into main via `d4463a9`. 30+ bugs fixed. |
| `sprint/providers` | `756c836` | Fully merged into main. Architecture diagrams. |

### Stale/Orphaned Branches (1)

| Branch | Commit | Status |
|--------|--------|--------|
| `v0.3.0-sprint` | `9255c62` | 74 ahead, 89 behind main. Remote tracking branch deleted. |

### Archive Branches (8)

These preserve the pre-rebuild codebase. All are 149 commits behind main with massive divergence ahead. They represent prioritized explorations from the earlier v0.6/v0.7 era.

| Branch | Ahead | Priority |
|--------|------:|----------|
| `archive/01-HIGH-prompt-pipeline-overlays` | 287 | HIGH |
| `archive/02-HIGH-dispatch-middleware-decompose` | 380 | HIGH |
| `archive/03-HIGH-clean-room-rebuild-ancestor` | 371 | HIGH |
| `archive/04-MED-dispatch-subprocess-entry` | 378 | MED |
| `archive/05-MED-dispatch-auth-ui-cleanup` | 368 | MED |
| `archive/06-LOW-debug-dispatch-diagnostic` | 370 | LOW |
| `archive/07-LOW-platform-era-v060` | 149 | LOW |
| `archive/08-LOW-release-v010-bump` | 8 | LOW |

### Remote-Only Branches (2)

| Branch | Commit | Note |
|--------|--------|------|
| `origin/main` | `d3bdc65` | 1 ahead of local main (blog post commit) |
| `origin/claude/write-pancode-blog-post-nkD7g` | `d3bdc65` | Claude-authored blog post |

---

## 5. Tags and Releases

| Tag | Commit | Date | GitHub Release? |
|-----|--------|------|-----------------|
| `v0.1.0` | `9bab000` | 2026-03-19 | Yes |
| `v0.2.0` | `46ca576` | 2026-03-19 | Yes (marked Latest) |

**No v0.3.0 tag or release exists** despite v0.3.0 code being on main since March 23. The CHANGELOG.md claims v0.3.0 was released on 2026-03-23 with 53 commits across 28 sprint tickets.

---

## 6. Working Tree State

### Staged Changes

None. The index is clean.

### Unstaged Deletions (3 files, 307 lines)

| File | Lines | Content |
|------|------:|---------|
| `AGENTS.md` | 135 | AI-agent onboarding guide (build commands, architecture rules, code style) |
| `templates/integration-test.sh` | 49 | Web-dev integration test setup script |
| `templates/web-dev-panagents.yaml` | 123 | 6 agent profile definitions (dev, architect, designer, qa, reviewer, scout) |

These files were deleted from disk but the deletions have not been staged.

### Untracked Files

One directory, not gitignored:

```
experiments/claude-inference-pipe/
    run.ts          20K
    run-tools.ts    19K
    run-warm.ts     14K
    translate.ts    15K
```

~68K of TypeScript inference pipeline experiments, created March 25.

### Remote Sync

Local `main` is **1 commit behind** `origin/main`. The remote has:
- `d3bdc65` "Add blog post: Your Coding Agent Is Missing a Runtime"

---

## 7. Stashes (12 entries)

| # | Branch | Label | Files | Era |
|---|--------|-------|------:|-----|
| 0 | `sprint/bugfix-safety` | WIP: prompt tool language fix | 3 | v0.3.0 sprint |
| 1 | `v0.3.0-sprint` | WIP: God Mode expansion | 1 | v0.3.0 sprint |
| 2 | `v0.3.0-sprint` | refactor: ConfigService simplification | 5 | v0.3.0 sprint |
| 3 | `v0.3.0-sprint` | alpha-dashboard-integration-draft | 1 | v0.3.0 sprint |
| 4 | `v0.3.0-sprint` | beta-17-partial | 5 | v0.3.0 sprint |
| 5 | `refactor/dispatch-v3` | Full working tree before clean-room rebuild | **93** | Pre-rebuild (massive snapshot: 7,532 insertions) |
| 6 | `debug/broken-dispatch-2026-03-09` | WIP: debug working tree | 18 | Pre-rebuild |
| 7 | `main` | Checkpoint: coding agent WIP pre-v0.7.6 reboot | 4 | Pre-rebuild |
| 8 | `main` | WIP: auth cache setter approach | 2 | Pre-rebuild |
| 9 | `main` | WIP: broken dispatch debugging 2026-03-09 | 14 | Pre-rebuild |
| 10 | `main` | subprocess default | 1 | Pre-rebuild |
| 11 | `main` | WIP: shared embedding filter | 9 | Pre-rebuild |

Stashes 0-4 are from v0.3.0 sprint work. Stashes 5-11 are archaeological artifacts from the pre-rebuild era (before March 19). Stash 5 is the largest, containing 93 files and essentially a full codebase snapshot from the dispatch-v3 refactor.

---

## 8. Worktrees

| Path | Branch | Status |
|------|--------|--------|
| `/home/akougkas/projects/pancode` | `main` | Active (primary) |
| `/tmp/pancode-future` | `sprint/future-experimental` | **Orphaned** (directory deleted) |
| `/tmp/pancode-future-beta` | `sprint/future-experimental-beta` | **Orphaned** (directory deleted) |

Both `/tmp/` worktrees reference directories that no longer exist on disk. They need `git worktree prune` to clean up.

---

## 9. Reflog and Special Refs

### Recent Reflog (last 10)

```
HEAD@{0}  checkout: v0.3.0-sprint -> main
HEAD@{1}  checkout: main -> v0.3.0-sprint
HEAD@{2-28} sequential commits on main (94009a7 back to 491e33b)
```

No rebases, resets, or destructive operations in recent history.

### Special Refs

| Ref | Status |
|-----|--------|
| `ORIG_HEAD` | Exists, pointing to `72f6eab` (stale, from a previous merge or reset) |
| `MERGE_HEAD` | Not present |
| `REBASE_HEAD` | Not present |
| `CHERRY_PICK_HEAD` | Not present |

No in-progress merge, rebase, or cherry-pick.

---

## 10. Codebase Structure and Metrics

### Size

| Scope | Files | Lines |
|-------|------:|------:|
| `src/` (application code) | 186 | 29,523 |
| `packages/` (vendored Pi SDK) | 196 | 79,151 |
| **Total TypeScript** | **382** | **108,674** |

### Source Breakdown by Directory

| Directory | Lines | Files | Share of src/ |
|-----------|------:|------:|-----:|
| `src/domains/` | 19,909 | 118 | 67% |
| `src/engine/` | 4,411 | 26 | 15% |
| `src/core/` | 2,574 | 27 | 9% |
| `src/worker/` | 1,160 | 4 | 4% |
| `src/entry/` | 730 | 1 | 2% |
| `src/cli/` | 534 | 9 | 2% |
| `src/types/` | 6 | 1 | <1% |

### 11 Domains

| Domain | Files | Dependencies | Role |
|--------|------:|-------------|------|
| ui | 25 | dispatch, agents, session, scheduling, observability | TUI dashboard, commands, renderers |
| dispatch | 17 | safety, agents, prompts | Task routing, worker spawn, resilience |
| providers | 15 | (loaded at boot, no manifest) | Model discovery, matching, local engines |
| prompts | 11 | (none) | Prompt compilation, fragments, tiering |
| safety | 9 | (none) | Action classification, audit, scope enforcement |
| agents | 8 | (none) | Agent specs, skills, teams, worker pool |
| intelligence | 8 | dispatch, agents | Intent detection, learning, rules upgrade |
| observability | 8 | dispatch | Metrics, telemetry, receipts |
| scheduling | 6 | dispatch, agents | Budget, cluster transport |
| session | 6 | (none) | Context registry, memory, shared board |
| panconfigure | 5 | scheduling | Config schema and service |

### Largest Files

| Lines | File |
|------:|------|
| 1,282 | `src/domains/dispatch/extension.ts` |
| 1,129 | `src/domains/ui/extension.ts` |
| 1,100 | `src/domains/ui/commands.ts` |
| 871 | `src/domains/prompts/fragments.ts` |
| 834 | `src/domains/dispatch/worker-spawn.ts` |
| 779 | `src/engine/runtimes/adapters/claude-sdk.ts` |
| 730 | `src/entry/orchestrator.ts` |
| 668 | `src/domains/ui/dashboard-widgets.ts` |
| 658 | `src/engine/runtimes/adapters/claude-sdk-remote.ts` |
| 617 | `src/worker/entry.ts` |

### 7 Runtime Adapters

| Adapter | File |
|---------|------|
| Claude SDK (native) | `claude-sdk.ts` (779 lines) |
| Claude SDK Remote | `claude-sdk-remote.ts` (658 lines) |
| Claude Code (CLI) | `claude-code.ts` |
| Codex (CLI) | `codex.ts` |
| Gemini (CLI) | `gemini.ts` |
| OpenCode (CLI) | `opencode.ts` |
| Copilot CLI | `copilot-cli.ts` |

### 3 Local Inference Engines

LM Studio, Ollama, llama.cpp (under `src/domains/providers/engines/`).

### Engine Boundary

7 files in `src/engine/` import from `@pancode/pi-*` (correct).  
1 file outside the boundary: `src/worker/safety-ext.ts` imports from `@pancode/pi-coding-agent`. This is intentional and allowlisted in `check-boundaries`.

### Test Files

Zero. 17 test files previously existed in `__NUKED/tests/` and were deliberately removed. Project operates under "no test theater, inline verification only" (locked decision #4). Smoke tests and stress tests exist as scripts in `scripts/`.

### Build

| Artifact | Size |
|----------|------|
| `dist/` total | 2.4 MB |
| `dist/orchestrator-*.js` | 520K (monolithic chunk) |
| Build date | 2026-03-25 (stale relative to current date) |

---

## 11. GitHub Issues and Project Board

### Issue Summary

| State | Count |
|-------|------:|
| Open | 60 |
| Closed | 53 |
| **Total** | **113** |

### Issue Breakdown by Category

| Range | Category | Total | Open | Closed |
|-------|----------|------:|-----:|-------:|
| #14-#38 | v0.3.0 sprint tickets | 25 | 0 | **25** |
| #39-#66 | Future enhancements | 28 | **28** | 0 |
| #67-#78 | TUI polish tickets | 12 | 0 | **12** |
| #80-#97 | Post-demo bugs (CS546 live demo, March 23) | ~18 | ~15 | ~3 |
| #98-#114 | Audit findings (state bugs, command conflicts, architecture) | ~17 | **17** | 0 |

### Labels

| Label | Total | Open | Closed |
|-------|------:|-----:|-------:|
| sprint-v0.3.0 | 37 | 0 | 37 |
| enhancement | 35 | 35 | 0 |
| bug | 27 | 24 | 3 |
| polish | 27 | 11 | 16 |
| runtime | 27 | 21 | 6 |
| audit | 17 | 17 | 0 |
| hardening | 12 | 5 | 7 |
| load-bearing | 8 | 0 | 8 |
| testing | 6 | 1 | 5 |

### Project Board (#6: PanCode v0.3.0 Sprint)

| Status | Count |
|--------|------:|
| Todo | 46 |
| In Progress | 0 |
| Done | 40 |
| **Total** | **86** |

### Pull Requests

Only 1 PR ever created: **#79** "v0.3.0: Multi-agent dispatch, TUI redesign, constitutional prompting" (CLOSED, 2026-03-23). All other integration happened via direct merges.

---

## 12. Specification and Documentation Inventory

### `.specs/` (gitignored, 3.6 MB)

**Core specs (top-level):**

| File | Size | Topic |
|------|------|-------|
| `PAN-ARCHITECTURE.md` | 47 KB | Master architecture: 10 domains, 6-level DAG, engine abstraction, 4-phase build plan |
| `PAN-SDK-V2.md` | 40 KB | SDK v2 specification |
| `PAN-COMMANDS.md` | 29 KB | Full command surface reference |
| `PAN-KEYBOARD-BINDINGS.md` | 25 KB | Keyboard binding reference |
| `PRODUCTIZATION.md` | 21 KB | XDG filesystem layout |
| `PAN-INFERENCE-PROVIDER.md` | 16 KB | Inference provider integration |
| `PAN-RUNTIMES-CLAUDE.md` | 14 KB | Claude Code runtime adapter |
| `PAN-DESIGN-LANGUAGE.md` | 14 KB | Visual design language |
| `PAN-MODELS.md` | 13 KB | Model system specification |
| `SESSION-UNIFICATION.md` | 13 KB | Session tracker unification |
| `PAN-WIDGET-CATALOG.md` | 9 KB | TUI widget catalog |
| `PAN-DESIGN-TOKENS.md` | 8 KB | Design token definitions |
| `PAN-MODES.md` | 5 KB | 4-layer behavioral model |
| `PAN-PRINCIPLES.md` | 4 KB | Design principles |
| `PAN-IDENTITY.md` | 3 KB | Brand and positioning |
| `PAN-CONSTITUTION.md` | — | Behavioral constraints |

**`.specs/LOCKED/` (frozen decisions):**
- `DESIGN-DECISIONS.md`: 3 locked deviations from earlier specs
- `PAN-PROVIDERS.md` (23 KB): Unified provider system spec
- `diagrams/`: Architecture layer diagrams (Mermaid) + Excalidraw sources

**`.specs/moonshot/`:** 4 files on advanced/competitive features.  
**`.specs/market-analysis/`:** Competitive analyses vs. Augment Code, Claude Code, Codex CLI, Gemini CLI, OpenCode, and others.  
**`.specs/ui-ux/`:** Design snapshots and stitch archives.

### `.claude/prompts/` (sprint execution engine)

| Category | Count | Prompts |
|----------|------:|---------|
| `01-runtime/` | 7 | Adapter parity, observability, model registry, metrics, receipts |
| `02-panos/` | 2 | Pan namespace, constitution engine |
| `03-workers/` | 4 | Agent specs, CLI binding, worker pool, lifecycle heartbeat |
| `04-hardening/` | 11 | Constants, dispatch lifecycle, config, safety, state management, security |
| `05-polish/` | 6 | TUI premium polish, editor, footer, models display, startup perf, hotreload |
| `06-testing/` | 5 | Smoke test, adapter discovery, multi-runtime, stress test, dispatch diagnostic |
| `07-release/` | 2 | Release checklist, demo scenarios |
| **Active total** | **37** | P01 through P37 |
| **Future plans** | **30** | Adaptive concurrency through worktree-path-locking |
| **Archived** | **48** | Completed prompts from prior sprints |

### Other Documentation

| File | Content |
|------|---------|
| `README.md` | 392 lines. Professional. Badges, quick start, architecture, roadmap. |
| `CHANGELOG.md` | Claims v0.3.0 released 2026-03-23. |
| `CONTRIBUTING.md` | 4.6 KB contribution guidelines. |
| `LICENSE` | Apache 2.0. |
| `docs/` | 8+ markdown files: architecture, config, demos, development, dispatch, domains, getting-started, troubleshooting. |
| `website/` | Astro-based docs site for pancode.dev. Deployed via GitHub Pages. |

### `.claude/` Configuration

| File | Content |
|------|---------|
| `CLAUDE.md` | Project instructions (build, style, architecture, locked decisions, git rules) |
| `agents/captain.md` | Strategic commander agent (16 KB) |
| `agents/coder.md` | Implementation agent (5 KB) |
| `agents/orchestrator.md` | Tactical orchestrator (6 KB) |
| `hooks/block-destructive-git.sh` | PreToolUse hook blocking destructive git commands |
| `WAR-ROOM.md` | Strategic audit document (18 KB, stale) |
| `project-management.md` | GitHub Project #6 workflow, field IDs, ticket creation protocol |
| `scheduled_tasks.lock` | 92-byte dangling lock file |

---

## 13. Dependencies

### Production (31 total)

**AI/LLM Providers:**
- `@anthropic-ai/claude-agent-sdk` (^0.2.81)
- `@anthropic-ai/sdk` (^0.73.0)
- `@aws-sdk/client-bedrock-runtime` (^3.983.0)
- `@google/genai` (^1.40.0)
- `@lmstudio/sdk` (^1.5.0)
- `@mistralai/mistralai` (1.14.1)
- `openai` (6.26.0)
- `ollama` (^0.6.3)

**Workspace packages (vendored Pi SDK):**
- `@pancode/pi-agent-core`
- `@pancode/pi-ai`
- `@pancode/pi-coding-agent`
- `@pancode/pi-tui`

**Core utilities:** `@sinclair/typebox`, `yaml`, `chalk`, `ajv`, `undici`

### Dev (7 total)

`@biomejs/biome`, `@types/*`, `tsup`, `tsx`, `typescript ~5.7.0`

---

## 14. CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `ci.yml` | Push/PR to main | Matrix (Node 20, 22): install, typecheck, boundaries, build, lint, smoke |
| `release.yml` | Tag push (`v*`) | Node 22: full build + GitHub Release |
| `deploy-website.yml` | Push to main (website/** or docs/**) | Astro build + GitHub Pages deploy |

---

## 15. Observations

### Clean Items
- v0.3.0 sprint: all 37 tickets closed
- 12 TUI polish tickets: all closed
- Engine boundary: clean (1 intentional, allowlisted exception)
- No in-progress merge, rebase, or cherry-pick
- Conventional commits used consistently

### Items Needing Attention

| Item | Detail |
|------|--------|
| **1 commit behind remote** | `origin/main` has a blog post commit not pulled locally |
| **3 unstaged deletions** | `AGENTS.md`, `templates/integration-test.sh`, `templates/web-dev-panagents.yaml` deleted but not staged |
| **Untracked experiments/** | 68K of inference pipe experiments, neither committed nor gitignored |
| **2 orphaned worktrees** | `/tmp/pancode-future` and `/tmp/pancode-future-beta` point to deleted directories |
| **12 stashes accumulated** | 5 from v0.3.0 sprint, 7 from pre-rebuild era. Stash 5 is a 93-file codebase snapshot. |
| **Stale ORIG_HEAD** | Points to `72f6eab`, leftover from a previous operation |
| **No v0.3.0 tag/release** | Code is on main, CHANGELOG claims release, but no git tag or GitHub Release exists |
| **Stale build** | `dist/` dated March 25, current date is April 16 |
| **60 open issues** | 28 future enhancements, 17 audit findings, ~15 post-demo bugs |
| **46 project board items in Todo** | Nothing in progress |
| **Empty src/providers/** | Vestigial directory, provider code lives in `src/domains/providers/` |
| **Node version mismatch** | README says >=20, package.json says >=22 |
| **Stale PROGRESS.md** | Reports v0.2.4-dev state (17,200 LOC) vs reality (29,523 LOC) |
| **Stale WAR-ROOM.md** | Strategic audit from March 24, not updated since |
| **dangling scheduled_tasks.lock** | 92-byte lock file in `.claude/` |
| **8 archive branches** | Pre-rebuild codebase preserved but heavily diverged. Candidates for pruning. |
| **2 merged sprint branches** | `sprint/bugfix-safety` and `sprint/providers` could be deleted |
| **v0.3.0-sprint branch orphaned** | Remote tracking deleted, 74 commits ahead of main, no longer active |

---

*Generated by multi-agent audit on 2026-04-16. Four parallel research agents examined git history, working tree state, specifications, and codebase metrics.*
