import type { DomainRegistry } from "../core/domain-loader";
import { extension as agentsExtension, manifest as agentsManifest } from "./agents";
import { extension as dispatchExtension, manifest as dispatchManifest } from "./dispatch";
import { extension as observabilityExtension, manifest as observabilityManifest } from "./observability";
import { extension as intelligenceExtension, manifest as intelligenceManifest } from "./intelligence";
import { extension as safetyExtension, manifest as safetyManifest } from "./safety";
import { extension as schedulingExtension, manifest as schedulingManifest } from "./scheduling";
import { extension as sessionExtension, manifest as sessionManifest } from "./session";
import { extension as uiExtension, manifest as uiManifest } from "./ui";

export const DOMAIN_REGISTRY = {
  safety: {
    manifest: safetyManifest,
    extension: safetyExtension,
  },
  session: {
    manifest: sessionManifest,
    extension: sessionExtension,
  },
  agents: {
    manifest: agentsManifest,
    extension: agentsExtension,
  },
  dispatch: {
    manifest: dispatchManifest,
    extension: dispatchExtension,
  },
  observability: {
    manifest: observabilityManifest,
    extension: observabilityExtension,
  },
  scheduling: {
    manifest: schedulingManifest,
    extension: schedulingExtension,
  },
  intelligence: {
    manifest: intelligenceManifest,
    extension: intelligenceExtension,
  },
  ui: {
    manifest: uiManifest,
    extension: uiExtension,
  },
} satisfies DomainRegistry;
