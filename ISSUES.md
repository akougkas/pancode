# PanCode Issue Tracker

Date: 2026-03-21

## H1 Hardening Sweep

### BLOCKER

None found. All sweeps pass without crashes, data corruption, or boundary violations.

### WARNING (both fixed)

**W1: PANCODE_ENABLED_DOMAINS env var was write-only (Sweep 1) [FIXED]**

`loadConfig()` never read `PANCODE_ENABLED_DOMAINS` from the environment.
The orchestrator set it at boot for child processes, but setting it before
boot had no effect on which domains loaded.

Fixed in `config.ts` (added `parseDomainList` to read the env var as a
fallback), `domain-loader.ts` (added `filterValidDomains` to warn and skip
unknown domain names), and `orchestrator.ts` (wired validation before
`resolveDomainOrder`). Unknown domains now produce a stderr warning and
are skipped instead of crashing.

**W2: capture mode exposed shadow_explore despite shadowEnabled: false (Sweep 3) [FIXED]**

`getToolsetForMode("capture")` included `shadow_explore` even though the
mode definition has `shadowEnabled: false` and describes itself as "no
dispatch, no planning."

Fixed in `modes.ts` by removing `shadow` from capture's toolset. Capture
now returns only task tools. All other modes with `shadowEnabled: true`
retain `shadow_explore`.

### COSMETIC

**C1: Default boot TUI captures stderr (Sweep 1)**

When booting with all domains (no env override), `[pancode:boot]` timing
messages go to stderr. The TUI absorbs them, so piping `2>&1 | grep` shows
nothing. The minimal-domain test shows them because the TUI still renders.
Not a bug since the messages are visible in the TUI's debug output.

### Sweep Summary

| Sweep | Description                 | Status |
|-------|-----------------------------|--------|
| 1     | Domain Loading & Config     | PASS (W1 fixed) |
| 2     | PanPrompt Engine            | PASS (33/33 combinations) |
| 3     | Mode Transitions & Tools    | PASS (W2 fixed) |
| 4     | Scout Engine                | PASS (patterns verified) |
| 5     | Dispatch & Worker Spawn     | PASS (static, needs interactive) |
| 6     | Preset Switching            | PASS (static, needs interactive) |
| 7     | Boundary Violations         | PASS (zero violations) |

## S0 Smoke Test

| Check | Description                 | Result |
|-------|-----------------------------|--------|
| S0-1  | npm run typecheck           | PASS |
| S0-2  | npm run check-boundaries    | PASS |
| S0-3  | npm run build               | PASS (100ms) |
| S0-4  | Default boot (all domains)  | PASS (65ms warm) |
| S0-5  | Minimal domain boot         | PASS |
| S0-6  | BOGUS domain (warn + skip)  | PASS |
| S0-7  | PanPrompt all combinations  | PASS (33/33) |
| S0-8  | Mode toolset contracts      | PASS (5/5 modes correct) |
| S0-9  | Preset loading              | PASS (4 presets, all with scoutModel) |
| S0-10 | Scout engine patterns       | PASS (bare Agent, profiles, depth) |
| S0-11 | Boundary integrity          | PASS (0 violations) |
| S0-12 | Domain registry completeness| PASS (8 enabled, 9 registered) |
| S0-13 | Codebase health             | PASS (145 TS files, 10 domains, clean git) |
| S0-14 | F2/F3 completion            | PASS (Panos identity, scoutModel in all presets) |

## Known Issues (pre-existing)

1. runs.json and metrics.json grow unbounded (no max entries, no TTL)
2. Pi SDK session JSONL files grow unbounded
3. /models shows embedding models in per-provider view
4. Cline plan mode has CLI bug (plan_mode_respond), workaround: use act mode
