import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "scheduling",
  dependsOn: ["dispatch", "agents"],
} as const satisfies DomainManifest;
