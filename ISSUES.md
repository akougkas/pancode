# H1 Hardening Sweep Results

Date: 2026-03-21

## BLOCKER

None found. All sweeps pass without crashes, data corruption, or boundary violations.

## WARNING

### W1: PANCODE_ENABLED_DOMAINS env var was write-only (Sweep 1) [FIXED]

`loadConfig()` never read `PANCODE_ENABLED_DOMAINS` from the environment.
The orchestrator set it at boot for child processes, but setting it before
boot had no effect on which domains loaded.

Fixed in `config.ts` (added `parseDomainList` to read the env var as a
fallback), `domain-loader.ts` (added `filterValidDomains` to warn and skip
unknown domain names), and `orchestrator.ts` (wired validation before
`resolveDomainOrder`). Unknown domains now produce a stderr warning and
are skipped instead of crashing.

### W2: capture mode exposed shadow_explore despite shadowEnabled: false (Sweep 3) [FIXED]

`getToolsetForMode("capture")` included `shadow_explore` even though the
mode definition has `shadowEnabled: false` and describes itself as "no
dispatch, no planning."

Fixed in `modes.ts` by removing `shadow` from capture's toolset. Capture
now returns only task tools. All other modes with `shadowEnabled: true`
retain `shadow_explore`.

## COSMETIC

### C1: Default boot TUI captures stderr (Sweep 1)

When booting with all domains (no env override), `[pancode:boot]` timing
messages go to stderr. The TUI absorbs them, so piping `2>&1 | grep` shows
nothing. The minimal-domain test shows them because the TUI still renders.
Not a bug since the messages are visible in the TUI's debug output.

## Sweep Summary

| Sweep | Description                 | Status |
|-------|-----------------------------|--------|
| 1     | Domain Loading & Config     | PASS (W1 fixed) |
| 2     | PanPrompt Engine            | PASS (33/33 combinations) |
| 3     | Mode Transitions & Tools    | PASS (W2 fixed) |
| 4     | Scout Engine                | PASS (patterns verified) |
| 5     | Dispatch & Worker Spawn     | PASS (static, needs interactive) |
| 6     | Preset Switching            | PASS (static, needs interactive) |
| 7     | Boundary Violations         | PASS (zero violations) |

## Verification

```
npm run typecheck         PASS
npm run check-boundaries  PASS
```
