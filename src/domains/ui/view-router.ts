/**
 * View router for the PanCode TUI.
 *
 * Manages which view is currently active in the main widget area.
 * Module-level state with simple getters/setters. The auto-transition
 * timer fires when the dispatch view has no running workers, switching
 * back to the editor view after a configurable idle delay.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Available views in the PanCode TUI main widget area. */
export type ViewName = "editor" | "dashboard" | "dispatch";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let currentView: ViewName = "editor";
let autoTransitionTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Get the currently active view. */
export function getView(): ViewName {
  return currentView;
}

/** Set the active view, cancelling any pending auto-transition. */
export function setView(name: ViewName): void {
  if (currentView === name) return;
  cancelAutoTransition();
  currentView = name;
}

/**
 * Toggle between two views. If the current view is `a`, switch to `b`;
 * otherwise switch to `a`. Returns the newly active view name.
 */
export function toggleView(a: ViewName, b: ViewName): ViewName {
  const next = currentView === a ? b : a;
  setView(next);
  return next;
}

// ---------------------------------------------------------------------------
// Auto-transition
// ---------------------------------------------------------------------------

/**
 * Schedule an auto-transition from 'dispatch' to 'editor' after a delay.
 * Called when the last running worker finishes. If new workers start before
 * the timer fires, cancelAutoTransition() prevents the switch.
 *
 * Only transitions if the view is still 'dispatch' when the timer fires.
 */
export function scheduleAutoTransition(delayMs = 3000): void {
  cancelAutoTransition();
  autoTransitionTimer = setTimeout(() => {
    autoTransitionTimer = null;
    if (currentView === "dispatch") {
      currentView = "editor";
    }
  }, delayMs);
}

/** Cancel any pending auto-transition timer. */
export function cancelAutoTransition(): void {
  if (autoTransitionTimer !== null) {
    clearTimeout(autoTransitionTimer);
    autoTransitionTimer = null;
  }
}

/** Reset the view router to its initial state. Called on session shutdown. */
export function resetViewRouter(): void {
  cancelAutoTransition();
  currentView = "editor";
}
