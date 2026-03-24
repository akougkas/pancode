import { defineRouteMiddleware, type StarlightRouteData } from "@astrojs/starlight/route-data";

const SITE_NAME = "PanCode";
const SITE_TITLE = "PanCode - Composable Multi-Agent Runtime for Software Engineering";
const SITE_DESCRIPTION =
  "Orchestrate coding agents the way Kubernetes orchestrates containers. Discover, dispatch, and observe heterogeneous agent fleets from one terminal. Open source, local-first, provider-agnostic.";
const SITE_URL = "https://pancode.dev";
const OG_IMAGE_URL = `${SITE_URL}/og-image.png`;
const OG_IMAGE_ALT = "PanCode runtime preview showing a terminal-based multi-agent control plane.";
const KEYWORDS =
  "multi-agent runtime, coding agent orchestrator, AI agent fleet management, local LLM orchestration, Claude Code alternative, Codex CLI, terminal AI, agent dispatch, PanCode, open source AI tools";

const softwareApplicationJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description:
    "Composable multi-agent runtime for software engineering. Orchestrates coding agents the way Kubernetes orchestrates containers.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: ["Linux", "macOS", "Windows (WSL)"],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free (Apache 2.0)",
    availability: "https://schema.org/InStock",
    url: SITE_URL,
  },
  author: {
    "@type": "Person",
    name: "Anthony Kougkas",
  },
  url: SITE_URL,
  codeRepository: "https://github.com/akougkas/pancode",
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  isAccessibleForFree: true,
});

type HeadEntry = StarlightRouteData["head"][number];

function getHeadKey(entry: HeadEntry): string | undefined {
  if (entry.tag === "title") {
    return "title";
  }

  if (entry.tag === "meta") {
    const identifier = entry.attrs?.name ?? entry.attrs?.property ?? entry.attrs?.["http-equiv"];
    return identifier ? `meta:${identifier}` : undefined;
  }

  if (entry.tag === "link") {
    return entry.attrs?.rel ? `link:${entry.attrs.rel}` : undefined;
  }

  if (entry.tag === "script" && entry.attrs?.type === "application/ld+json") {
    return "script:application/ld+json";
  }

  return undefined;
}

function upsertHeadEntry(head: StarlightRouteData["head"], entry: HeadEntry) {
  const key = getHeadKey(entry);

  if (!key) {
    head.push(entry);
    return;
  }

  const index = head.findIndex((item) => getHeadKey(item) === key);

  if (index === -1) {
    head.push(entry);
    return;
  }

  head[index] = entry;
}

function isHomeRoute(route: StarlightRouteData, pathname: string) {
  return pathname === "/" || route.entry.id === "index" || route.entry.data.title.trim() === SITE_NAME;
}

function getSeoTitle(route: StarlightRouteData, pathname: string) {
  if (isHomeRoute(route, pathname)) {
    return SITE_TITLE;
  }

  return `${route.entry.data.title} | ${SITE_TITLE}`;
}

function getSeoDescription(route: StarlightRouteData) {
  return route.entry.data.description?.trim() || SITE_DESCRIPTION;
}

export const onRequest = defineRouteMiddleware(async (context, next) => {
  await next();

  const route = context.locals.starlightRoute;
  const title = getSeoTitle(route, context.url.pathname);
  const description = getSeoDescription(route);
  const url = new URL(context.url.pathname, SITE_URL).href;

  upsertHeadEntry(route.head, { tag: "title", content: title });
  upsertHeadEntry(route.head, { tag: "meta", attrs: { name: "description", content: description } });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { property: "og:title", content: title },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { property: "og:description", content: description },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { property: "og:type", content: "website" },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { property: "og:url", content: url },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { property: "og:image", content: OG_IMAGE_URL },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { property: "og:image:alt", content: OG_IMAGE_ALT },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { name: "twitter:card", content: "summary_large_image" },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { name: "twitter:title", content: title },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { name: "twitter:description", content: description },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { name: "twitter:image", content: OG_IMAGE_URL },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { name: "keywords", content: KEYWORDS },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: {
      name: "robots",
      content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { name: "author", content: "Anthony Kougkas" },
  });
  upsertHeadEntry(route.head, {
    tag: "meta",
    attrs: { name: "application-name", content: SITE_NAME },
  });
  upsertHeadEntry(route.head, {
    tag: "link",
    attrs: { rel: "manifest", href: "/manifest.json" },
  });

  if (isHomeRoute(route, context.url.pathname)) {
    upsertHeadEntry(route.head, {
      tag: "script",
      attrs: { type: "application/ld+json" },
      content: softwareApplicationJsonLd,
    });
  }
});
