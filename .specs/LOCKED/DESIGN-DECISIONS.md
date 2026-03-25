# Locked Design Decisions

Intentional deviations from earlier specs, documented here so future sprints
do not "fix" what is not broken.

## 1. Theme and model switching uses natural language, not slash commands

The orchestrator (PanOS) handles "switch to dark theme" and "use claude-sonnet"
through `pan_apply_config`. Slash commands (`/theme`, `/models`) are display
surfaces that show current state and also accept direct arguments for quick
changes. The LLM-mediated path provides validation, confirmation, and
context-aware suggestions that raw commands cannot.

## 2. /reset naming differs from spec

The spec says `/new` for session reset. The code uses `/reset` (alias of Pi's
`/new`). This is intentional: `/new` is reserved as a Pi pass-through, `/reset`
is the PanCode-branded equivalent.

## 3. Footer uses line renderer, not grid cards

The spec proposed metric grid cards in the footer. Implementation uses a 5-line
footer renderer with mode, safety, model, reasoning, and workers. The line
renderer is more information-dense and responsive than grid cards at narrow
terminal widths.
