import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "observability",
  dependsOn: ["dispatch"],
} as const satisfies DomainManifest;
