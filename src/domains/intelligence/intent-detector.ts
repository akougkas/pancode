/**
 * Task classification (experimental).
 * Categorizes incoming tasks to inform dispatch routing.
 */

import type { Intent } from "./contracts";

const CODING_PATTERNS = /\b(implement|add|create|build|write|fix|refactor|update|change)\b/i;
const REVIEW_PATTERNS = /\b(review|check|audit|analyze|inspect|verify)\b/i;
const RESEARCH_PATTERNS = /\b(research|explore|investigate|find|search|discover|understand)\b/i;
const TESTING_PATTERNS = /\b(test|verify|validate|assert|check)\b/i;

export function detectIntent(task: string): Intent {
  const normalized = task.toLowerCase();

  let category: Intent["category"] = "unknown";
  if (CODING_PATTERNS.test(normalized)) category = "coding";
  else if (REVIEW_PATTERNS.test(normalized)) category = "review";
  else if (RESEARCH_PATTERNS.test(normalized)) category = "research";
  else if (TESTING_PATTERNS.test(normalized)) category = "testing";

  const wordCount = task.split(/\s+/).length;
  let complexity: Intent["complexity"] = "simple";
  if (wordCount > 50) complexity = "complex";
  else if (wordCount > 20) complexity = "moderate";

  return {
    task,
    category,
    complexity,
    estimatedTokens: wordCount * 100,
  };
}
