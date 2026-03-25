# Changelog

## [0.3.0] - 2026-03-24

v0.3.0 delivers a ground-up TUI redesign, a multi-dimensional worker pool,
constitutional prompting, a full observability stack, and a comprehensive
safety hardening pass across 70+ commits spanning 28 sprint tickets plus
a focused bugfix sprint.

### Added

**Core Runtime**
- Pan-prefixed configuration namespace (panagents.yaml, panpresets.yaml, pansafety.yaml, panproviders.yaml) replacing legacy file names
- Constitutional prompt fragments that enforce behavioral consistency across all orchestrator modes
- PanModels registry with capability matching, performance tiers, and provider-agnostic model selection
- Typed bus event helpers for safe cross-domain communication

**Dispatch and Workers**
- PanWorker pool with multi-dimensional scoring for agent-to-worker assignment
- Worker heartbeat monitoring with health classification and automatic stale detection
- Reproducibility receipt system for audit-ready dispatch verification
- Persistent dispatch ledger with graceful telemetry degradation

**Agents**
- Expanded AgentSpec with prompt templates, speed ratings, autonomy levels, and tags
- CLI runtime discovery and wiring into agent specs with tier classification (frontier, mid, small)
- Claude Agent SDK adapter for SDK-tier integration alongside CLI adapters

**Observability**
- 4-tier telemetry for runtime adapter parity auditing
- Structured correlation IDs, secret redaction, and reason codes in safety events

**UI/TUI (12-ticket redesign)**
- Full terminal dashboard with responsive breakpoints (compact, standard, wide)
- Dashboard state manager with incremental updates and staleness tracking
- View router with editor, dashboard, and dispatch board states
- 13-channel event bus integration for real-time log collection with severity levels
- Contextual empty states and loading indicators for all dashboard widgets
- Structured panel renderer (PanelSpec) for consistent slash command output
- Dynamic multi-line footer with context window category visualization
- Premium editor borders with mode badges and rounded corners
- Compact boot banner with system health summary
- /perf command for runtime performance metrics and boot timing export
- /workers command for worker pool display with scores
- Complete /hotkeys command showing all keyboard shortcuts

**Providers**
- Adapter parity audit with nullable usage tracking across all runtime adapters

### Changed

- Unified TuiColorizer replaces per-component colorizers (BoardColorizer, DashboardColorizer, FooterColorizer)
- Slash command handlers extracted into dedicated commands.ts module for maintainability
- Agent names and message type constants centralized into shared constants
- /theme command now persists theme selection to settings.json
- Keyboard shortcuts (Shift+Tab, Ctrl+Y, Alt+A) now emit CONFIG_CHANGED events
- User reasoning preference tracked and preserved across mode transitions
- Review mode locked down to prevent indirect mutations via pan_apply_config
- Recent runs display increased from 8 to 10 entries

### Fixed

- Admin mode state desync between Alt+A and CONFIG_CHANGED handlers
- Safety level persisted to disk without corresponding mode, causing dangerous post-restart state
- Mode transitions silently overwriting user-set reasoning preference
- Keyboard shortcuts not emitting CONFIG_CHANGED events
- Theme default aligned with registered Pi SDK builtins, resolving "Theme not found" errors
- Removed conflicting keyboard shortcuts (ctrl+d, ctrl+o, ctrl+t) that collided with reserved bindings
- Build mode prompts strengthened with ANTI rules to enforce dispatch-only orchestration
- Dashboard trailing whitespace stripped from slash command panel output
- Session continuity restored with shutdown orphan cleanup
- Configurable ring buffers and atomic writes for all state persistence paths
- Dispatch pattern validation and lifecycle hardening for edge cases
- Provider routing audit and action classification coverage gaps closed
- Mode and safety policy enforcement hardened against bypass scenarios
- Domain isolation and config resolution corrected for multi-domain loads
- /agents table narrowed to fit 90-column terminals with SPD/AUTO/TAGS columns
- /mode renamed to /modes to avoid Pi SDK prefix collision on command matching
- tmux extended-keys auto-configured for proper keyboard handling
- Panel spacing, alignment, and border consistency corrected across all views
- Boot banner grammar ("1 nodes" fixed to correct pluralization)
- Budget ceiling display formatting ($10.0 corrected to $10.00)
- Context window display showing "0 / ?" when model context limit unknown
- Agent registry panel truncation of long agent names
- Orchestrator prompt strengthened to prefer node over python for data analysis
- Duplicate and conflicting command registrations removed
- Four dead Pi commands identified and documented
- /cost and /budget overlap resolved
- /status command removed (duplicate of /dashboard)
- Pi SDK actionHandlers guarded against undefined access

### Removed

- Cline CLI adapter removed (upstream plan_mode_respond bug made readonly enforcement unreliable)
- Deprecated /status command (use /dashboard instead)
- Legacy command listings that duplicated Pi SDK built-in help

### Testing

- 7-phase baseline smoke test with automated health audit
- Width-safety regression harness for all TUI widgets
- Adapter discovery and invocation smoke test for all runtime types
- Multi-runtime integration test across all available adapters
- Scaling stress test for concurrent worker verification
- 5-layer dispatch diagnostic audit scripts
- 9-scenario interactive smoke test covering boot, commands, and clean exit
