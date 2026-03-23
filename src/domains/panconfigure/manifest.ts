import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "panconfigure",
  dependsOn: ["scheduling"],
} as const satisfies DomainManifest;
