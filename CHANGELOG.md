# Changelog

## [0.3.0] - 2026-03-23

v0.3.0 delivers a ground-up TUI redesign, a multi-dimensional worker pool,
constitutional prompting, and a full observability stack across 53 commits
spanning 28 sprint tickets.

### Added

**Core Runtime**
- Pan-prefixed configuration namespace (pancode.yaml, panagents.yaml, panmodels.yaml) replacing legacy file names
- Constitutional prompt fragments that enforce behavioral consistency across all orchestrator modes
- PanModels registry with capability matching, performance tiers, and provider-agnostic model selection

**Dispatch and Workers**
- PanWorker pool with multi-dimensional scoring for agent-to-worker assignment
- Worker heartbeat monitoring with health classification and automatic stale detection
- Reproducibility receipt system for audit-ready dispatch verification
- Persistent dispatch ledger with graceful telemetry degradation

**Agents**
- Expanded AgentSpec with prompt templates, speed ratings, autonomy levels, and tags
- CLI runtime discovery and wiring into agent specs with tier classification (frontier, mid, small)

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
- /safety command for live safety mode switching

**Providers**
- Adapter parity audit with nullable usage tracking across all runtime adapters

### Changed

- Unified TuiColorizer replaces per-component colorizers (BoardColorizer, DashboardColorizer, FooterColorizer)
- Slash command handlers extracted into dedicated commands.ts module for maintainability
- Agent names and message type constants centralized into shared constants

### Fixed

- Theme default aligned with registered Pi SDK builtins, resolving "Theme not found" errors on /export
- Removed conflicting keyboard shortcuts (ctrl+d, ctrl+o, ctrl+t) that collided with Pi SDK reserved bindings
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

### Testing

- 7-phase baseline smoke test with automated health audit
- Width-safety regression harness for all TUI widgets
- Adapter discovery and invocation smoke test for all runtime types
- Multi-runtime integration test across all available adapters
- Scaling stress test for concurrent worker verification
- 5-layer dispatch diagnostic audit scripts
