/**
 * Base agent card widget interface and default implementation.
 *
 * Every card widget implements CardWidget. The default AgentCardWidget
 * delegates to the existing renderDispatchCard() for backward compatibility.
 * Runtime-specific cards (e.g., Claude SDK) implement their own rendering.
 *
 * No class hierarchy, no abstract methods. Just an interface and implementations.
 */

import type { TuiColorizer } from "../dashboard-theme";
import type { DispatchCardData } from "../dispatch-board";
import { renderDispatchCard } from "../dispatch-board";

/** Contract: all card widgets implement this. */
export interface CardWidget {
  /** Runtime ID this widget handles, or null for the default card. */
  readonly runtimeId: string | null;
  /** Render the card as an array of terminal-ready strings. */
  render(card: DispatchCardData, width: number, c: TuiColorizer): string[];
}

/** Default implementation: delegates to the existing renderDispatchCard(). */
export class AgentCardWidget implements CardWidget {
  readonly runtimeId = null;

  render(card: DispatchCardData, width: number, c: TuiColorizer): string[] {
    return renderDispatchCard(card, width, c);
  }
}
