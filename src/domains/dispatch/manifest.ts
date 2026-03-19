import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "dispatch",
  dependsOn: ["safety", "agents"],
} as const satisfies DomainManifest;
