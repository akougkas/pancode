import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "intelligence",
  dependsOn: ["dispatch", "agents"],
} as const satisfies DomainManifest;
