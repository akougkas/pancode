import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "session",
  dependsOn: [],
} as const satisfies DomainManifest;
