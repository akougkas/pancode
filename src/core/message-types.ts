/**
 * Canonical PanCode message type constants for Pi SDK custom entries.
 *
 * Extensions use these types when calling pi.sendMessage({ customType }) or
 * pi.appendEntry(). A single source of truth prevents silent breakage when
 * message type strings are renamed or added.
 */
export const PanMessageType = {
  PANEL: "pancode-panel",
  CHECKPOINT: "pancode-checkpoint",
  MODE_TRANSITION: "pancode-mode-transition",
} as const;

export type PanMessageTypeValue = (typeof PanMessageType)[keyof typeof PanMessageType];
