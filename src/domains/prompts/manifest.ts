import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "prompts",
  dependsOn: [],
} as const satisfies DomainManifest;
