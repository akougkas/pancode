/**
 * Card widget registry for runtime-specific dispatch cards.
 *
 * Maps runtime IDs to specialized card widgets. Falls back to the default
 * AgentCardWidget when no runtime-specific widget is registered.
 */

import { AgentCardWidget, type CardWidget } from "./agent-card";

const registry = new Map<string, CardWidget>();
const defaultWidget = new AgentCardWidget();

/** Register a runtime-specific card widget. */
export function registerCardWidget(runtimeId: string, widget: CardWidget): void {
  registry.set(runtimeId, widget);
}

/**
 * Get the card widget for a given runtime ID.
 * Returns the default AgentCardWidget when no runtime-specific widget is registered.
 */
export function getCardWidget(runtimeId: string | undefined): CardWidget {
  if (runtimeId) {
    const widget = registry.get(runtimeId);
    if (widget) return widget;
  }
  return defaultWidget;
}

/** Clear all registered widgets. Used in tests and session cleanup. */
export function clearCardWidgets(): void {
  registry.clear();
}
