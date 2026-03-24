// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

const siteTitle = "PanCode";
const siteDescription =
  "Orchestrate coding agents the way Kubernetes orchestrates containers. Discover, dispatch, and observe heterogeneous agent fleets from one terminal. Open source, local-first, provider-agnostic.";
const googleFontsHref =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700;800&family=Schibsted+Grotesk:wght@500;600;700;800&display=swap";

// https://astro.build/config
export default defineConfig({
  site: "https://pancode.dev",
  integrations: [
    starlight({
      title: siteTitle,
      description: siteDescription,
      logo: {
        light: "./src/assets/pancode-logo-light.svg",
        dark: "./src/assets/pancode-logo-dark.svg",
        alt: "PanCode",
        replacesTitle: false,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/akougkas/pancode",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/akougkas/pancode/edit/main/docs/",
      },
      routeMiddleware: "./src/starlightRouteData.ts",
      customCss: ["./src/styles/global.css"],
      favicon: "/favicon.svg",
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
            { label: "Core Concepts", slug: "getting-started/core-concepts" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Configuration", slug: "guides/configuration" },
            { label: "Agents", slug: "guides/agents" },
            { label: "Providers", slug: "guides/providers" },
            { label: "Dispatch", slug: "guides/dispatch" },
            { label: "Safety", slug: "guides/safety" },
            { label: "Observability", slug: "guides/observability" },
            { label: "Teams", slug: "guides/teams" },
            { label: "Modes & Presets", slug: "guides/modes-and-presets" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Commands", slug: "reference/commands" },
            { label: "CLI", slug: "reference/cli" },
            { label: "Configuration Reference", slug: "reference/configuration-reference" },
            { label: "Keyboard Shortcuts", slug: "reference/keyboard-shortcuts" },
            { label: "Environment Variables", slug: "reference/environment-variables" },
          ],
        },
        {
          label: "Architecture",
          items: [
            { label: "Overview", slug: "architecture/overview" },
            { label: "Domains", slug: "architecture/domains" },
            { label: "Engine Boundary", slug: "architecture/engine-boundary" },
            { label: "Worker Isolation", slug: "architecture/worker-isolation" },
            { label: "Event System", slug: "architecture/event-system" },
          ],
        },
        {
          label: "Tutorials",
          items: [
            { label: "Local Fleet Setup", slug: "tutorials/local-fleet" },
            { label: "Multi-Agent Dispatch", slug: "tutorials/multi-agent-dispatch" },
            { label: "Custom Agent", slug: "tutorials/custom-agent" },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Contributing", slug: "development/contributing" },
            { label: "Adding Domains", slug: "development/adding-domains" },
            { label: "Adding Runtimes", slug: "development/adding-runtimes" },
          ],
        },
        { label: "Troubleshooting", slug: "troubleshooting" },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            content: "#09090b",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "color-scheme",
            content: "dark",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.googleapis.com",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: "anonymous",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: googleFontsHref,
            as: "style",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: googleFontsHref,
            media: "print",
            onload: "this.media='all'",
          },
        },
        {
          tag: "noscript",
          content: `<link rel="stylesheet" href="${googleFontsHref}">`,
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
