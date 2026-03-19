export type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@pancode/pi-coding-agent";

import type { ExtensionFactory } from "@pancode/pi-coding-agent";

export function defineExtension(factory: ExtensionFactory): ExtensionFactory {
  return factory;
}
