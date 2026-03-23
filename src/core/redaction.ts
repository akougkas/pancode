/**
 * Pattern-based secret redaction for log output.
 *
 * Compiled regex patterns are cached at module load time to avoid
 * per-call compilation overhead on hot paths. Each pattern maps to a
 * descriptive label used in the replacement string.
 */

interface RedactionPattern {
  regex: RegExp;
  label: string;
}

const REDACTION_PATTERNS: RedactionPattern[] = [
  { regex: /sk-[a-zA-Z0-9]{20,}/g, label: "openai_key" },
  { regex: /ANTHROPIC_API_KEY=[^\s]+/g, label: "anthropic_key" },
  { regex: /Bearer [a-zA-Z0-9._-]+/g, label: "bearer_token" },
  { regex: /[a-f0-9]{40}/g, label: "hex_token" },
];

/**
 * Scan input for known secret patterns and replace matches with
 * `[REDACTED:label]` placeholders. Safe to call on any string.
 */
export function redact(input: string): string {
  let result = input;
  for (const { regex, label } of REDACTION_PATTERNS) {
    regex.lastIndex = 0;
    result = result.replace(regex, `[REDACTED:${label}]`);
  }
  return result;
}
