import type { DomainManifest } from "../../core/domain-loader";

export const manifest = {
  name: "ui",
  dependsOn: ["dispatch", "agents", "session", "scheduling", "observability"],
} as const satisfies DomainManifest;
