// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://pancode.dev",
  integrations: [
    starlight({
      title: "PanCode",
      description: "Composable multi-agent runtime for software engineering",
      logo: {
        light: "./src/assets/pancode-logo-light.svg",
        dark: "./src/assets/pancode-logo-dark.svg",
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
      customCss: ["./src/styles/global.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "docs/getting-started" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Configuration", slug: "docs/configuration" },
            { label: "Dispatch", slug: "docs/dispatch" },
            { label: "Domains", slug: "docs/domains" },
          ],
        },
        {
          label: "Architecture",
          items: [
            { label: "Overview", slug: "docs/architecture" },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Contributing", slug: "docs/development" },
          ],
        },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            content: "#16c858",
          },
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
