#!/usr/bin/env npx tsx
/**
 * run-tools.ts
 *
 * Experiment Phase 2: Tool Call Interception
 *
 * Tests whether Claude Code SDK V2 streams tool_use content blocks BEFORE
 * attempting execution, and whether canUseTool denial is graceful.
 *
 * This is critical for the inference provider use case: Pi's agent loop needs
 * to see tool call intent from the model, deny Claude Code's execution, and
 * execute the tools itself through Pi's safety model.
 *
 * Usage: npx tsx experiments/claude-inference-pipe/run-tools.ts [--verbose]
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
  translateSdkStream,
  type TranslationResult,
  type ToolCall,
} from "./translate.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL = process.env.PANCODE_TEST_MODEL ?? "sonnet";
const VERBOSE = process.argv.includes("--verbose");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hr(label: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(60)}\n`);
}

function pass(label: string): void {
  console.log(`  [PASS] ${label}`);
}

function fail(label: string, detail?: string): void {
  console.log(`  [FAIL] ${label}${detail ? `: ${detail}` : ""}`);
}

function info(label: string, value: unknown): void {
  console.log(`  ${label}: ${value}`);
}

function extractText(result: TranslationResult): string {
  return result.finalMessage.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("");
}

function extractToolCalls(result: TranslationResult): ToolCall[] {
  return result.finalMessage.content.filter(
    (c): c is ToolCall => c.type === "toolCall",
  );
}

// ---------------------------------------------------------------------------
// Shared tool denial tracker
// ---------------------------------------------------------------------------

interface ToolDenialRecord {
  toolName: string;
  input: Record<string, unknown>;
  timestamp: number;
}

function createDenyAllHandler(): {
  handler: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<PermissionResult>;
  denials: ToolDenialRecord[];
} {
  const denials: ToolDenialRecord[] = [];
  const handler = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    denials.push({ toolName, input, timestamp: Date.now() });
    return { behavior: "deny", message: "PanCode inference pipe: tool execution intercepted" };
  };
  return { handler, denials };
}

// ---------------------------------------------------------------------------
// Test 7: Tool Call Streaming Visibility
// ---------------------------------------------------------------------------

async function test7_toolCallStreaming(): Promise<boolean> {
  hr("Test 7: Tool Call Streaming Visibility");
  console.log("  Prompt the model to read a file. Tools enabled, all denied.");
  console.log("  Verify: tool_use blocks appear in streaming events BEFORE execution.\n");

  const { handler, denials } = createDenyAllHandler();

  const q = query({
    prompt: "Read the file /tmp/pancode-test-marker.txt and tell me what it says.",
    options: {
      model: MODEL,
      systemPrompt: "You are a coding assistant. Use your tools to help the user.",
      // DO NOT set tools: [] here. We want default Claude Code tools.
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
      canUseTool: handler,
    },
  });

  const result = await translateSdkStream(q, MODEL);

  // Check for tool call events in the stream
  const hasToolcallStart = result.events.some((e) => e.type === "toolcall_start");
  const hasToolcallDelta = result.events.some((e) => e.type === "toolcall_delta");
  const hasToolcallEnd = result.events.some((e) => e.type === "toolcall_end");
  const toolCalls = extractToolCalls(result);

  console.log("  Tool call events in stream:");
  hasToolcallStart
    ? pass("toolcall_start event emitted")
    : fail("toolcall_start not found (model may not have attempted tool use)");
  hasToolcallDelta
    ? pass("toolcall_delta events emitted")
    : info("NOTE", "No toolcall_delta (tool args may have been empty or arrived in one block)");
  hasToolcallEnd
    ? pass("toolcall_end event emitted")
    : fail("toolcall_end not found");

  // Verify tool call structure
  if (toolCalls.length > 0) {
    const tc = toolCalls[0];
    pass(`Tool call captured: name="${tc.name}", id="${tc.id}"`);
    info("Tool args", tc.args.length > 200 ? tc.args.substring(0, 200) + "..." : tc.args);

    const hasId = tc.id.length > 0;
    const hasName = tc.name.length > 0;
    const hasArgs = tc.args.length > 0;

    hasId ? pass("Tool call has non-empty ID") : fail("Empty tool call ID");
    hasName ? pass("Tool call has non-empty name") : fail("Empty tool call name");
    hasArgs ? pass("Tool call has non-empty args") : fail("Empty tool call args");

    // Try to parse args as JSON
    try {
      const parsed = JSON.parse(tc.args);
      pass(`Tool args parse as valid JSON: ${JSON.stringify(parsed).substring(0, 100)}`);
    } catch {
      fail("Tool args are not valid JSON", tc.args.substring(0, 100));
    }
  } else {
    fail("No tool calls in final message content");
  }

  // Verify stop reason
  const stopReason = result.finalMessage.stopReason;
  info("Stop reason", stopReason);
  stopReason === "toolUse"
    ? pass("Stop reason is 'toolUse' (model intended to call tools)")
    : info("NOTE", `Stop reason is '${stopReason}' (model may have answered without tools)`);

  // Verify canUseTool was called (denials recorded)
  info("canUseTool invocations", denials.length);
  if (denials.length > 0) {
    pass("canUseTool callback was invoked");
    for (const d of denials) {
      info("  Denied tool", `${d.toolName} with input: ${JSON.stringify(d.input).substring(0, 100)}`);
    }
  } else {
    info("NOTE", "canUseTool was never called (denial may happen at SDK level, not callback)");
  }

  // Check SDK result for permission_denials
  if (result.sdkResult && "permission_denials" in result.sdkResult) {
    const pd = (result.sdkResult as { permission_denials: unknown[] }).permission_denials;
    info("SDK permission_denials", pd.length);
    if (pd.length > 0) {
      pass("Permission denials tracked in SDK result");
      if (VERBOSE) {
        for (const denial of pd) {
          console.log(`    ${JSON.stringify(denial)}`);
        }
      }
    }
  }

  // Show any text content alongside tool calls
  const textContent = extractText(result).trim();
  if (textContent) {
    info("Text alongside tools", `"${textContent.substring(0, 150)}..."`);
  }

  // Print full SDK message type sequence
  if (VERBOSE) {
    console.log("\n  SDK message type sequence:");
    for (const t of result.sdkMessageTypes) {
      console.log(`    ${t}`);
    }
    console.log("\n  Pi event sequence:");
    for (const e of result.events) {
      if (e.type === "text_delta" || e.type === "toolcall_delta" || e.type === "thinking_delta") {
        const delta = (e as { delta: string }).delta;
        console.log(`    ${e.type}: "${delta.length > 60 ? delta.substring(0, 60) + "..." : delta}"`);
      } else {
        console.log(`    ${e.type}`);
      }
    }
  }

  console.log();
  printWarnings(result);

  return hasToolcallStart && toolCalls.length > 0;
}

function printWarnings(result: TranslationResult): void {
  if (result.warnings.length > 0) {
    console.log("  Warnings:");
    for (const w of result.warnings) {
      console.log(`    - ${w}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test 8: Multi-Tool Interception
// ---------------------------------------------------------------------------

async function test8_multiToolInterception(): Promise<boolean> {
  hr("Test 8: Multi-Tool Interception");
  console.log("  Prompt the model to perform a task requiring multiple tool calls.");
  console.log("  Verify: multiple tool_use blocks captured, all denied gracefully.\n");

  const { handler, denials } = createDenyAllHandler();

  const q = query({
    prompt:
      "List the files in /tmp/ and then read the first one you find. Do both steps.",
    options: {
      model: MODEL,
      systemPrompt: "You are a coding assistant. Use tools to complete the task.",
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
      canUseTool: handler,
    },
  });

  const result = await translateSdkStream(q, MODEL);
  const toolCalls = extractToolCalls(result);
  const toolcallStartCount = result.events.filter((e) => e.type === "toolcall_start").length;
  const toolcallEndCount = result.events.filter((e) => e.type === "toolcall_end").length;

  info("Tool calls in response", toolCalls.length);
  info("toolcall_start events", toolcallStartCount);
  info("toolcall_end events", toolcallEndCount);

  if (toolCalls.length >= 1) {
    pass(`${toolCalls.length} tool call(s) captured`);
    for (const tc of toolCalls) {
      info(`  Tool`, `name="${tc.name}", id="${tc.id.substring(0, 20)}...", args_len=${tc.args.length}`);
    }
  } else {
    fail("No tool calls captured");
  }

  // Verify start/end counts match
  toolcallStartCount === toolcallEndCount
    ? pass(`Balanced events: ${toolcallStartCount} start, ${toolcallEndCount} end`)
    : fail(`Unbalanced: ${toolcallStartCount} start vs ${toolcallEndCount} end`);

  // Verify denials
  info("canUseTool denials recorded", denials.length);
  if (denials.length > 0) {
    pass("All tool executions were intercepted by canUseTool");
  }

  // Verify the stream completed without error
  const hasDone = result.events.some((e) => e.type === "done");
  const hasError = result.events.some((e) => e.type === "error");
  hasDone ? pass("Stream completed with done event") : fail("No done event");
  !hasError ? pass("No error events") : fail("Error event emitted");

  printWarnings(result);

  return toolCalls.length >= 1 && hasDone && !hasError;
}

// ---------------------------------------------------------------------------
// Test 9: Tool Name Mapping Inventory
// ---------------------------------------------------------------------------

async function test9_toolNameInventory(): Promise<boolean> {
  hr("Test 9: Claude Code Tool Name Inventory");
  console.log("  Discover which tool names Claude Code uses by prompting for common");
  console.log("  coding operations. Maps Claude Code names to Pi equivalents.\n");

  // Run three prompts that trigger different tools
  const prompts = [
    { task: "Run the command 'echo hello' in bash.", expectedTool: "Bash" },
    { task: "Read the file /etc/hostname.", expectedTool: "Read" },
    {
      task: "Search for the word 'pancode' in all TypeScript files in the current directory.",
      expectedTool: "Grep",
    },
  ];

  const discoveredTools = new Map<string, string>();

  for (const p of prompts) {
    const { handler } = createDenyAllHandler();

    const q = query({
      prompt: p.task,
      options: {
        model: MODEL,
        systemPrompt: "You are a coding assistant. Use your tools.",
        maxTurns: 1,
        includePartialMessages: true,
        persistSession: false,
        canUseTool: handler,
      },
    });

    const result = await translateSdkStream(q, MODEL);
    const toolCalls = extractToolCalls(result);

    if (toolCalls.length > 0) {
      const name = toolCalls[0].name;
      discoveredTools.set(p.expectedTool, name);
      pass(`"${p.task.substring(0, 40)}..." → tool: "${name}"`);
    } else {
      fail(`"${p.task.substring(0, 40)}..." → no tool call emitted`);
    }
  }

  // Print mapping table
  console.log("\n  Claude Code → Pi Tool Name Mapping:");
  console.log("  ┌────────────────────┬────────────────────┬────────────────────┐");
  console.log("  │ Expected           │ CC Tool Name       │ Pi Equivalent      │");
  console.log("  ├────────────────────┼────────────────────┼────────────────────┤");

  const piMapping: Record<string, string> = {
    Bash: "bash_exec",
    Read: "file_read",
    Write: "file_write",
    Edit: "file_edit",
    Glob: "glob_find",
    Grep: "grep_search",
    Agent: "dispatch_agent",
    WebFetch: "web_fetch",
    WebSearch: "web_search",
  };

  for (const [expected, actual] of discoveredTools) {
    const piName = piMapping[actual] ?? "???";
    console.log(
      `  │ ${expected.padEnd(18)} │ ${actual.padEnd(18)} │ ${piName.padEnd(18)} │`,
    );
  }
  console.log("  └────────────────────┴────────────────────┴────────────────────┘");

  return discoveredTools.size >= 2;
}

// ---------------------------------------------------------------------------
// Test 10: Tool Args Structure Validation
// ---------------------------------------------------------------------------

async function test10_toolArgsStructure(): Promise<boolean> {
  hr("Test 10: Tool Args Structure Validation");
  console.log("  Verify tool call args are valid JSON with expected fields.\n");

  const { handler } = createDenyAllHandler();

  const q = query({
    prompt: "Run this bash command: ls -la /tmp/",
    options: {
      model: MODEL,
      systemPrompt: "You are a coding assistant. Execute the command the user requests.",
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
      canUseTool: handler,
    },
  });

  const result = await translateSdkStream(q, MODEL);
  const toolCalls = extractToolCalls(result);

  if (toolCalls.length === 0) {
    fail("No tool calls to validate");
    return false;
  }

  const tc = toolCalls[0];
  info("Tool name", tc.name);
  info("Tool ID", tc.id);
  info("Raw args", tc.args.substring(0, 300));

  // Parse args
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(tc.args);
    pass("Args parse as valid JSON");
  } catch {
    fail("Args are not valid JSON");
    return false;
  }

  // Report all fields
  console.log("\n  Tool call arg fields:");
  for (const [key, value] of Object.entries(parsed)) {
    const valStr = typeof value === "string" ? `"${value}"` : JSON.stringify(value);
    info(`  ${key}`, valStr.length > 80 ? valStr.substring(0, 80) + "..." : valStr);
  }

  // Verify the args contain the command
  const argsStr = JSON.stringify(parsed);
  const containsCommand = argsStr.includes("ls") || argsStr.includes("/tmp");
  containsCommand
    ? pass("Args contain the requested command/path")
    : fail("Args don't contain expected command");

  // Verify tool call event ordering: start → delta* → end
  const toolEvents = result.events.filter(
    (e) => e.type === "toolcall_start" || e.type === "toolcall_delta" || e.type === "toolcall_end",
  );
  const ordering = toolEvents.map((e) => e.type);
  const validOrdering =
    ordering[0] === "toolcall_start" && ordering[ordering.length - 1] === "toolcall_end";
  validOrdering
    ? pass(`Tool event ordering: ${ordering.join(" → ")}`)
    : fail(`Invalid ordering: ${ordering.join(" → ")}`);

  printWarnings(result);

  return containsCommand && validOrdering;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Claude Code SDK V2 Tool Call Interception Experiment       ║");
  console.log("║  Phase 2: Can Pi intercept tool calls from Claude Code?     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  info("Model", MODEL);
  info("SDK", "@anthropic-ai/claude-agent-sdk");
  info("Date", new Date().toISOString());
  info("Verbose", VERBOSE);

  const results: { name: string; passed: boolean }[] = [];

  const tests = [
    { name: "Tool Call Streaming", fn: test7_toolCallStreaming },
    { name: "Multi-Tool Interception", fn: test8_multiToolInterception },
    { name: "Tool Name Inventory", fn: test9_toolNameInventory },
    { name: "Tool Args Structure", fn: test10_toolArgsStructure },
  ];

  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed });
    } catch (error) {
      console.log(
        `\n  [ERROR] ${test.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (VERBOSE && error instanceof Error) {
        console.log(`  Stack: ${error.stack}`);
      }
      results.push({ name: test.name, passed: false });
    }
  }

  // Summary
  hr("PHASE 2 EXPERIMENT SUMMARY");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  for (const r of results) {
    console.log(`  ${r.passed ? "[PASS]" : "[FAIL]"} ${r.name}`);
  }

  console.log();
  console.log(`  Result: ${passed}/${total} tests passed`);
  console.log();

  if (passed === total) {
    console.log("  TOOL INTERCEPTION CONFIRMED. Claude Code SDK V2 streams");
    console.log("  tool_use blocks before execution. canUseTool denial is");
    console.log("  graceful. Pi can capture tool intent and execute through");
    console.log("  its own safety model.");
  } else if (passed > 0) {
    console.log("  PARTIAL CONFIRMATION. Some tool interception paths work.");
    console.log("  Review failed tests for specific limitations.");
  } else {
    console.log("  TOOL INTERCEPTION FAILED. Claude Code may not stream");
    console.log("  tool_use blocks in a form Pi can intercept.");
  }

  console.log();
  process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(2);
});
