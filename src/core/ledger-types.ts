export interface SessionBoundary {
  type: "session_start" | "session_end";
  timestamp: string;
  sessionId: string;
}

// biome-ignore lint/suspicious/noExplicitAny: type guard must accept heterogeneous union types across domains
export function isSessionBoundary(entry: any): entry is SessionBoundary {
  return (
    typeof entry === "object" && entry !== null && (entry.type === "session_start" || entry.type === "session_end")
  );
}
