import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "safety",
  dependsOn: [],
} as const satisfies DomainManifest;
