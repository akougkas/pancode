/**
 * Enhanced task classification with confidence scoring.
 *
 * Categorizes incoming tasks to inform dispatch routing. Uses
 * weighted keyword matching with confidence scoring. Falls back
 * to heuristic classification when no model is available.
 *
 * Future: use a local small model for higher-accuracy classification.
 */

import type { Intent } from "./contracts";

interface PatternEntry {
  category: Intent["category"];
  patterns: RegExp[];
  weight: number;
}

const PATTERN_TABLE: PatternEntry[] = [
  {
    category: "coding",
    patterns: [
      /\b(implement|add|create|build|write|fix|refactor|update|change|modify|migrate|port)\b/i,
      /\b(function|class|module|component|endpoint|api|handler|route)\b/i,
    ],
    weight: 1.0,
  },
  {
    category: "review",
    patterns: [
      /\b(review|check|audit|analyze|inspect|verify|assess|evaluate|critique)\b/i,
      /\b(bug|issue|vulnerability|security|performance|quality)\b/i,
    ],
    weight: 0.9,
  },
  {
    category: "research",
    patterns: [
      /\b(research|explore|investigate|find|search|discover|understand|explain|how does)\b/i,
      /\b(architecture|design|pattern|approach|strategy|trade-?off)\b/i,
    ],
    weight: 0.85,
  },
  {
    category: "testing",
    patterns: [/\b(test|spec|assert|expect|mock|stub|coverage|e2e|integration|unit)\b/i],
    weight: 0.9,
  },
  {
    category: "refactoring",
    patterns: [
      /\b(refactor|simplify|clean|reorganize|restructure|extract|inline|rename)\b/i,
      /\b(dead code|unused|duplicate|consolidate|dedup)\b/i,
    ],
    weight: 0.85,
  },
  {
    category: "planning",
    patterns: [
      /\b(plan|design|architect|propose|spec|outline|breakdown|decompose)\b/i,
      /\b(roadmap|milestone|phase|step-by-step|approach)\b/i,
    ],
    weight: 0.8,
  },
  {
    category: "documentation",
    patterns: [
      /\b(document|readme|docstring|comment|jsdoc|tsdoc|changelog|release notes)\b/i,
      /\b(explain|describe|annotate|markdown)\b/i,
    ],
    weight: 0.75,
  },
];

/** Extract file paths from task text for speculative pre-read. */
function extractPaths(task: string): string[] {
  const paths = new Set<string>();

  // Quoted paths
  const quotedPattern = /["'`]((?:[a-zA-Z0-9_\-./\\]+\.[\w]+))["'`]/g;
  let match = quotedPattern.exec(task);
  while (match !== null) {
    paths.add(match[1]);
    match = quotedPattern.exec(task);
  }

  // Unquoted file-like paths
  const unquotedPattern = /(?:^|\s)((?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[\w]+)/g;
  match = unquotedPattern.exec(task);
  while (match !== null) {
    paths.add(match[1]);
    match = unquotedPattern.exec(task);
  }

  return [...paths];
}

/** Determine suggested model tier based on complexity. */
function suggestTier(complexity: Intent["complexity"], category: Intent["category"]): Intent["suggestedTier"] {
  if (category === "planning" || complexity === "complex") return "frontier";
  if (category === "research" || category === "review") return "mid";
  if (complexity === "simple") return "small";
  return "any";
}

export function detectIntent(task: string): Intent {
  const normalized = task.toLowerCase();

  // Score each category
  let bestCategory: Intent["category"] = "unknown";
  let bestScore = 0;

  for (const entry of PATTERN_TABLE) {
    let score = 0;
    for (const pattern of entry.patterns) {
      const matches = normalized.match(pattern);
      if (matches) {
        score += entry.weight;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = entry.category;
    }
  }

  // Confidence: higher when score is strong, lower when ambiguous
  const confidence = bestCategory === "unknown" ? 0.2 : Math.min(0.95, 0.5 + bestScore * 0.2);

  const wordCount = task.split(/\s+/).length;
  let complexity: Intent["complexity"] = "simple";
  if (wordCount > 50) complexity = "complex";
  else if (wordCount > 20) complexity = "moderate";

  const mentionedPaths = extractPaths(task);
  const suggestedTier = suggestTier(complexity, bestCategory);

  return {
    task,
    category: bestCategory,
    complexity,
    estimatedTokens: wordCount * 100,
    confidence,
    mentionedPaths,
    suggestedTier,
  };
}
