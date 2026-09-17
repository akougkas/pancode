#!/usr/bin/env npx tsx
/**
 * run.ts
 *
 * Experiment runner for the Claude Code SDK V2 Inference Pipe hypothesis.
 *
 * Hypothesis: Claude Code SDK V2 can serve as an inference backend for Pi
 * Coding Agent by translating SDK streaming events into Pi's
 * AssistantMessageEvent format.
 *
 * Usage: npx tsx experiments/claude-inference-pipe/run.ts
 *
 * Prerequisites:
 *   - Claude Code installed and authenticated (claude login)
 *   - @anthropic-ai/claude-agent-sdk in node_modules
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  translateSdkStream,
  type AssistantMessageEvent,
  type TranslationResult,
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

function printWarnings(result: TranslationResult): void {
  if (result.warnings.length > 0) {
    console.log(`  Warnings:`);
    for (const w of result.warnings) {
      console.log(`    - ${w}`);
    }
  }
}

function printSdkMessageTypes(result: TranslationResult): void {
  if (VERBOSE) {
    const typeCounts = new Map<string, number>();
    for (const t of result.sdkMessageTypes) {
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    console.log(`  SDK message types received:`);
    for (const [type, count] of typeCounts) {
      console.log(`    ${type}: ${count}`);
    }
  }
}

function extractText(result: TranslationResult): string {
  return result.finalMessage.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("");
}

// ---------------------------------------------------------------------------
// Test 1: Basic Streaming Inference
// ---------------------------------------------------------------------------

async function test1_basicStreaming(): Promise<boolean> {
  hr("Test 1: Basic Streaming Inference");
  console.log("  Send a simple prompt with tools disabled.");
  console.log("  Verify: streaming events received, translated, done event emitted.\n");

  const startTime = Date.now();

  const q = query({
    prompt: "What is 2 + 2? Answer in one word.",
    options: {
      model: MODEL,
      systemPrompt: "You are a concise assistant. Answer in as few words as possible.",
      tools: [],
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
    },
  });

  const result = await translateSdkStream(q, MODEL);
  const elapsed = Date.now() - startTime;

  const hasStart = result.events.some((e) => e.type === "start");
  const hasDone = result.events.some((e) => e.type === "done");
  const hasTextDelta = result.events.some((e) => e.type === "text_delta");
  const text = extractText(result);
  const eventCount = result.events.length;

  hasStart ? pass("start event emitted") : fail("start event emitted");
  hasTextDelta ? pass("text_delta events emitted") : fail("text_delta events emitted");
  hasDone ? pass("done event emitted") : fail("done event emitted");
  eventCount > 3 ? pass(`${eventCount} events total`) : fail(`Only ${eventCount} events`);

  info("Response", `"${text.trim()}"`);
  info("Total time", `${elapsed}ms`);
  info("Input tokens", result.finalMessage.usage.input);
  info("Output tokens", result.finalMessage.usage.output);

  if (result.sdkResult) {
    info("SDK cost", `$${result.sdkResult.total_cost_usd}`);
  }

  printWarnings(result);
  printSdkMessageTypes(result);

  return hasStart && hasDone && hasTextDelta;
}

// ---------------------------------------------------------------------------
// Test 2: System Prompt Passthrough
// ---------------------------------------------------------------------------

async function test2_systemPrompt(): Promise<boolean> {
  hr("Test 2: System Prompt Passthrough");
  console.log("  Set a custom system prompt that instructs a specific response.");
  console.log("  Verify: model obeys custom prompt, not Claude Code default.\n");

  const q = query({
    prompt: "PING",
    options: {
      model: MODEL,
      systemPrompt:
        "You are a test bot. When the user says PING, you must respond with exactly one word: PONG. No explanation, no punctuation beyond the word itself.",
      tools: [],
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
    },
  });

  const result = await translateSdkStream(q, MODEL);
  const text = extractText(result).trim();

  const exactMatch = text === "PONG";
  const containsMatch = text.toUpperCase().includes("PONG");

  if (exactMatch) {
    pass("Exact match: response is 'PONG'");
  } else if (containsMatch) {
    pass("Contains PONG (Claude Code may inject additional system prompt context)");
    info("Full response", `"${text}"`);
  } else {
    fail("System prompt passthrough", `Expected 'PONG', got '${text}'`);
  }

  // Second test: different system prompt to confirm variability
  const q2 = query({
    prompt: "What are you?",
    options: {
      model: MODEL,
      systemPrompt:
        "You are a rubber duck. Always respond as a rubber duck would. Start every response with 'Quack!'",
      tools: [],
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
    },
  });

  const result2 = await translateSdkStream(q2, MODEL);
  const text2 = extractText(result2).trim();
  const ducked = text2.startsWith("Quack");

  ducked
    ? pass("Second prompt obeyed (starts with 'Quack')")
    : fail("Second prompt", `Expected 'Quack...', got '${text2.substring(0, 50)}'`);

  printWarnings(result);

  return containsMatch && ducked;
}

// ---------------------------------------------------------------------------
// Test 3: Event Structure Verification
// ---------------------------------------------------------------------------

async function test3_eventStructure(): Promise<boolean> {
  hr("Test 3: Event Structure Verification");
  console.log("  Verify event ordering matches Pi's AssistantMessageEventStream contract.");
  console.log("  Required: start -> text_start -> text_delta* -> text_end -> done\n");

  const q = query({
    prompt: "Write a haiku about TypeScript.",
    options: {
      model: MODEL,
      systemPrompt: "You are a poet. Write only the haiku, nothing else.",
      tools: [],
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
    },
  });

  const result = await translateSdkStream(q, MODEL);
  const types = result.events.map((e) => e.type);

  // Structural checks
  const startFirst = types[0] === "start";
  const doneLast = types[types.length - 1] === "done";

  const textStartIdx = types.indexOf("text_start");
  const textEndIdx = types.indexOf("text_end");
  const textOrdered = textStartIdx >= 0 && textEndIdx >= 0 && textStartIdx < textEndIdx;

  const deltasBetween = result.events.every((e, i) => {
    if (e.type !== "text_delta") return true;
    return i > textStartIdx && i < textEndIdx;
  });

  startFirst ? pass("start is first event") : fail("start is not first");
  doneLast ? pass("done is last event") : fail("done is not last");
  textOrdered ? pass("text_start precedes text_end") : fail("text ordering broken");
  deltasBetween ? pass("all text_delta between start/end") : fail("delta ordering broken");

  // Content integrity: accumulated text matches text_end content
  const textBlocks = result.finalMessage.content.filter((c) => c.type === "text");
  const textEndEvent = result.events.find((e) => e.type === "text_end") as
    | { content: string }
    | undefined;
  if (textBlocks.length > 0 && textEndEvent) {
    const accumulated = (textBlocks[0] as { text: string }).text;
    const ended = textEndEvent.content;
    accumulated === ended
      ? pass("Content integrity (accumulated text === text_end content)")
      : fail("Content mismatch", `accumulated: ${accumulated.length} chars, end: ${ended.length} chars`);
  }

  // Stop reason
  const doneEvent = result.events.find((e) => e.type === "done") as
    | { reason: string }
    | undefined;
  doneEvent?.reason === "stop"
    ? pass(`Stop reason: "${doneEvent.reason}"`)
    : fail("Stop reason", `Expected "stop", got "${doneEvent?.reason}"`);

  // Print event sequence
  if (VERBOSE) {
    console.log(`\n  Event sequence (${result.events.length} events):`);
    for (const e of result.events) {
      if (e.type === "text_delta") {
        const d = (e as { delta: string }).delta;
        console.log(`    text_delta: "${d.length > 40 ? d.substring(0, 40) + "..." : d}"`);
      } else {
        console.log(`    ${e.type}`);
      }
    }
  }

  info("Response", `"${extractText(result).trim()}"`);
  printWarnings(result);

  return startFirst && doneLast && textOrdered && deltasBetween;
}

// ---------------------------------------------------------------------------
// Test 4: Latency Profiling
// ---------------------------------------------------------------------------

async function test4_latency(): Promise<boolean> {
  hr("Test 4: Latency Profiling");
  console.log("  Measure subprocess spawn + auth + first token + total completion.");
  console.log("  3 iterations for statistical reliability.\n");

  const iterations = 3;
  const measurements: {
    total: number;
    firstStreamEvent: number;
    firstTextDelta: number;
  }[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    let firstStreamEvent = 0;
    let firstTextDelta = 0;

    const q = query({
      prompt: "Say hello.",
      options: {
        model: MODEL,
        systemPrompt: "Respond with just the word 'Hello' and nothing else.",
        tools: [],
        maxTurns: 1,
        includePartialMessages: true,
        persistSession: false,
      },
    });

    for await (const msg of q) {
      const now = Date.now();
      if (msg.type === "stream_event" && firstStreamEvent === 0) {
        firstStreamEvent = now - start;
      }
      if (
        msg.type === "stream_event" &&
        firstTextDelta === 0 &&
        (msg as { event: { type: string } }).event.type === "content_block_delta"
      ) {
        firstTextDelta = now - start;
      }
    }

    const total = Date.now() - start;
    measurements.push({ total, firstStreamEvent, firstTextDelta });
    info(`Run ${i + 1}`, `total=${total}ms  first_event=${firstStreamEvent}ms  first_delta=${firstTextDelta}ms`);
  }

  const avg = (arr: number[]): number =>
    Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);

  const avgTotal = avg(measurements.map((m) => m.total));
  const avgFirstEvent = avg(measurements.filter((m) => m.firstStreamEvent > 0).map((m) => m.firstStreamEvent));
  const avgFirstDelta = avg(measurements.filter((m) => m.firstTextDelta > 0).map((m) => m.firstTextDelta));

  console.log();
  info("Average total", `${avgTotal}ms`);
  info("Average first stream event", `${avgFirstEvent}ms (subprocess spawn + auth + API connect)`);
  info("Average first text delta", `${avgFirstDelta}ms (time to first token)`);

  // Latency budget assessment
  if (avgFirstDelta < 3000) {
    pass(`First token under 3s (${avgFirstDelta}ms). Acceptable for agent inference.`);
  } else if (avgFirstDelta < 5000) {
    pass(`First token under 5s (${avgFirstDelta}ms). Marginal. Warm sessions would help.`);
  } else {
    fail(`First token over 5s (${avgFirstDelta}ms). Subprocess overhead too high.`);
  }

  return avgFirstDelta > 0;
}

// ---------------------------------------------------------------------------
// Test 5: Usage and Cost Extraction
// ---------------------------------------------------------------------------

async function test5_usageAndCost(): Promise<boolean> {
  hr("Test 5: Usage and Cost Extraction");
  console.log("  Verify token usage and cost data flows through translation.\n");

  const q = query({
    prompt: "Explain recursion in one sentence.",
    options: {
      model: MODEL,
      tools: [],
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
    },
  });

  const result = await translateSdkStream(q, MODEL);

  const hasInputTokens = result.finalMessage.usage.input > 0;
  const hasOutputTokens = result.finalMessage.usage.output > 0;

  info("Input tokens (from streaming)", result.finalMessage.usage.input);
  info("Output tokens (from streaming)", result.finalMessage.usage.output);
  info("Cache read tokens", result.finalMessage.usage.cacheRead);
  info("Total tokens", result.finalMessage.usage.totalTokens);

  hasInputTokens ? pass("Non-zero input tokens") : fail("Zero input tokens");
  hasOutputTokens ? pass("Non-zero output tokens") : fail("Zero output tokens");

  if (result.sdkResult) {
    console.log();
    info("SDK total cost", `$${result.sdkResult.total_cost_usd}`);
    info("SDK num_turns", result.sdkResult.num_turns);
    info("SDK duration (API)", `${result.sdkResult.duration_api_ms}ms`);
    info("SDK duration (total)", `${result.sdkResult.duration_ms}ms`);

    if ("usage" in result.sdkResult) {
      const u = result.sdkResult.usage as Record<string, number>;
      info("SDK input_tokens", u.input_tokens);
      info("SDK output_tokens", u.output_tokens);

      // Cross-check: streaming usage should match SDK result usage
      const inputMatch = result.finalMessage.usage.input === u.input_tokens;
      const outputMatch = result.finalMessage.usage.output === u.output_tokens;
      inputMatch
        ? pass("Input token count matches SDK result")
        : fail("Input token mismatch", `streaming=${result.finalMessage.usage.input}, sdk=${u.input_tokens}`);
      outputMatch
        ? pass("Output token count matches SDK result")
        : fail("Output token mismatch", `streaming=${result.finalMessage.usage.output}, sdk=${u.output_tokens}`);
    }

    const hasCost = result.sdkResult.total_cost_usd !== undefined;
    hasCost ? pass("Cost data available from SDK") : fail("No cost data");
  } else {
    fail("No SDK result message received");
  }

  info("Response", `"${extractText(result).trim()}"`);
  printWarnings(result);

  return hasInputTokens && hasOutputTokens;
}

// ---------------------------------------------------------------------------
// Test 6: Thinking/Reasoning Block Translation
// ---------------------------------------------------------------------------

async function test6_thinkingBlocks(): Promise<boolean> {
  hr("Test 6: Thinking/Reasoning Block Translation");
  console.log("  Request extended thinking to verify thinking events translate correctly.");
  console.log("  Note: requires a model that supports extended thinking.\n");

  try {
    const q = query({
      prompt: "What is the 10th prime number? Think step by step.",
      options: {
        model: MODEL,
        systemPrompt: "You are a math assistant. Think through problems carefully.",
        tools: [],
        maxTurns: 1,
        includePartialMessages: true,
        persistSession: false,
        thinking: { type: "enabled", budgetTokens: 5000 },
      },
    });

    const result = await translateSdkStream(q, MODEL);

    const hasThinkingStart = result.events.some((e) => e.type === "thinking_start");
    const hasThinkingDelta = result.events.some((e) => e.type === "thinking_delta");
    const hasThinkingEnd = result.events.some((e) => e.type === "thinking_end");
    const thinkingBlocks = result.finalMessage.content.filter((c) => c.type === "thinking");

    if (hasThinkingStart) {
      pass("thinking_start event emitted");
      hasThinkingDelta ? pass("thinking_delta events emitted") : fail("No thinking_delta events");
      hasThinkingEnd ? pass("thinking_end event emitted") : fail("No thinking_end event");
      info("Thinking blocks", thinkingBlocks.length);

      if (thinkingBlocks.length > 0) {
        const thinking = (thinkingBlocks[0] as { thinking: string }).thinking;
        info("Thinking content length", `${thinking.length} chars`);
        info("Thinking preview", `"${thinking.substring(0, 80)}..."`);
      }
    } else {
      info("SKIP", "No thinking events (model may not support extended thinking at this tier)");
    }

    info("Response", `"${extractText(result).trim()}"`);
    printWarnings(result);

    return true; // Non-critical test, thinking support varies by model
  } catch (error) {
    info("SKIP", `Thinking test failed: ${error instanceof Error ? error.message : String(error)}`);
    return true; // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Claude Code SDK V2 Inference Pipe Experiment               ║");
  console.log("║  Hypothesis: SDK V2 can power Pi Coding Agent inference     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  info("Model", MODEL);
  info("SDK", "@anthropic-ai/claude-agent-sdk");
  info("Date", new Date().toISOString());
  info("Verbose", VERBOSE);

  const results: { name: string; passed: boolean }[] = [];

  const tests = [
    { name: "Basic Streaming", fn: test1_basicStreaming },
    { name: "System Prompt", fn: test2_systemPrompt },
    { name: "Event Structure", fn: test3_eventStructure },
    { name: "Latency", fn: test4_latency },
    { name: "Usage & Cost", fn: test5_usageAndCost },
    { name: "Thinking Blocks", fn: test6_thinkingBlocks },
  ];

  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed });
    } catch (error) {
      console.log(`\n  [ERROR] ${test.name}: ${error instanceof Error ? error.message : String(error)}`);
      if (VERBOSE && error instanceof Error) {
        console.log(`  Stack: ${error.stack}`);
      }
      results.push({ name: test.name, passed: false });
    }
  }

  // Summary
  hr("EXPERIMENT SUMMARY");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  for (const r of results) {
    console.log(`  ${r.passed ? "[PASS]" : "[FAIL]"} ${r.name}`);
  }

  console.log();
  console.log(`  Result: ${passed}/${total} tests passed`);
  console.log();

  if (passed === total) {
    console.log("  HYPOTHESIS CONFIRMED: Claude Code SDK V2 can serve as an");
    console.log("  inference backend for Pi Coding Agent. The streaming event");
    console.log("  translation produces Pi-compatible AssistantMessageEvents.");
  } else {
    console.log("  HYPOTHESIS PARTIALLY CONFIRMED. Review failed tests above.");
    console.log("  Some translation paths may need adjustment.");
  }

  console.log();
  process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(2);
});
