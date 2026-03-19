#!/usr/bin/env node
const { mkdirSync, cpSync } = require("fs");

// Theme assets (JSON theme files, schema)
mkdirSync("dist/modes/interactive/theme", { recursive: true });
cpSync("src/modes/interactive/theme", "dist/modes/interactive/theme", {
  recursive: true,
  filter: (s) => !s.endsWith(".ts"),
});

// Export HTML templates and vendor files
mkdirSync("dist/core/export-html/vendor", { recursive: true });
cpSync("src/core/export-html/template.html", "dist/core/export-html/template.html");
cpSync("src/core/export-html/template.css", "dist/core/export-html/template.css");
cpSync("src/core/export-html/template.js", "dist/core/export-html/template.js");
cpSync("src/core/export-html/vendor", "dist/core/export-html/vendor", {
  recursive: true,
  filter: (s) => !s.endsWith(".ts"),
});
