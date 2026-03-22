# PanCode Issue Tracker

Date: 2026-03-21

## H1 Hardening Sweep

### BLOCKER

None found. All sweeps pass without crashes, data corruption, or boundary violations.


### COSMETIC

**C1: Default boot TUI captures stderr (Sweep 1)**

When booting with all domains (no env override), `[pancode:boot]` timing
messages go to stderr. The TUI absorbs them, so piping `2>&1 | grep` shows
nothing. The minimal-domain test shows them because the TUI still renders.
Not a bug since the messages are visible in the TUI's debug output.


## Known Issues (pre-existing)

1. runs.json and metrics.json grow unbounded (no max entries, no TTL)
2. Pi SDK session JSONL files grow unbounded
3. /models shows embedding models in per-provider view
4. Cline plan mode has CLI bug (plan_mode_respond), workaround: use act mode
