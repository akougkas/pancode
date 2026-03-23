/**
 * Meta-agent pattern for self-diagnosis and configuration.
 *
 * An orchestrator-level agent that dispatches parallel specialist
 * queries to diagnose and configure PanCode itself. Spawns four
 * specialist scouts that analyze different aspects of the system.
 */

export interface SpecialistQuery {
  specialist: "config" | "runtime" | "prompt" | "health";
  description: string;
  task: string;
}

export interface DiagnosisResult {
  specialist: string;
  findings: string[];
  suggestions: string[];
  severity: "info" | "warning" | "error";
}

/**
 * Generate specialist queries for diagnosing a PanCode issue.
 *
 * Given a user question like "why is dispatch slow?", generates
 * four parallel queries for config, runtime, prompt, and health
 * specialists.
 */
export function generateDiagnosticQueries(question: string): SpecialistQuery[] {
  return [
    {
      specialist: "config",
      description: "Configuration specialist",
      task: `Analyze PanCode configuration for issues related to: ${question}\n\nCheck panpresets.yaml, panagents.yaml, environment variables, and settings. Report any misconfigurations, missing values, or suboptimal settings.`,
    },
    {
      specialist: "runtime",
      description: "Runtime specialist",
      task: `Analyze PanCode runtime state for issues related to: ${question}\n\nCheck available providers, models, runtimes, and their health status. Report any connectivity issues, version mismatches, or capacity problems.`,
    },
    {
      specialist: "prompt",
      description: "Prompt specialist",
      task: `Analyze PanCode prompt compilation for issues related to: ${question}\n\nCheck compiled prompts, fragment coverage, system prompt length, and token efficiency. Report any missing fragments, oversized prompts, or compilation errors.`,
    },
    {
      specialist: "health",
      description: "Health specialist",
      task: `Run PanCode health checks for issues related to: ${question}\n\nCheck worker pool status, dispatch ledger, metrics, and recent error rates. Report any failed health probes, stale state, or resource exhaustion.`,
    },
  ];
}

/**
 * Generate project scaffolding queries for setting up PanCode
 * in a new project.
 */
export function generateScaffoldQueries(projectRoot: string): SpecialistQuery[] {
  return [
    {
      specialist: "config",
      description: "Project scanner",
      task: `Scan the project at ${projectRoot} and identify: language(s), framework(s), test runner, build system, package manager. Report findings in structured format.`,
    },
    {
      specialist: "runtime",
      description: "Model advisor",
      task: `Given the project at ${projectRoot}, recommend appropriate models for orchestrator (frontier) and worker (mid/small) roles. Consider available local models and cloud providers.`,
    },
    {
      specialist: "prompt",
      description: "Agent designer",
      task: `Based on the project at ${projectRoot}, suggest appropriate agent specifications. Consider the language, framework, and test infrastructure to determine which tools each agent needs.`,
    },
    {
      specialist: "health",
      description: "Safety advisor",
      task: `Review the project at ${projectRoot} and suggest safety rules. Identify directories that should be protected, commands that should be restricted, and appropriate autonomy levels.`,
    },
  ];
}

/**
 * Synthesize diagnosis results from multiple specialists into
 * a unified summary.
 */
export function synthesizeDiagnosis(results: DiagnosisResult[]): string {
  const lines: string[] = ["Diagnosis Summary", ""];

  // Group by severity
  const errors = results.filter((r) => r.severity === "error");
  const warnings = results.filter((r) => r.severity === "warning");
  const info = results.filter((r) => r.severity === "info");

  if (errors.length > 0) {
    lines.push("Errors:");
    for (const r of errors) {
      for (const finding of r.findings) {
        lines.push(`  [${r.specialist}] ${finding}`);
      }
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push("Warnings:");
    for (const r of warnings) {
      for (const finding of r.findings) {
        lines.push(`  [${r.specialist}] ${finding}`);
      }
    }
    lines.push("");
  }

  if (info.length > 0) {
    lines.push("Info:");
    for (const r of info) {
      for (const finding of r.findings) {
        lines.push(`  [${r.specialist}] ${finding}`);
      }
    }
    lines.push("");
  }

  // Collect all suggestions
  const allSuggestions = results.flatMap((r) => r.suggestions);
  if (allSuggestions.length > 0) {
    lines.push("Suggestions:");
    for (const suggestion of allSuggestions) {
      lines.push(`  ${suggestion}`);
    }
  }

  return lines.join("\n");
}
