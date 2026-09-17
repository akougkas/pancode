#!/usr/bin/env npx tsx
/**
 * run-warm.ts
 *
 * Experiment Phase 3: Warm Session Viability
 *
 * Tests whether V2 createSession() can serve as a warm inference backend.
 * Critical questions:
 *   1. Does session.stream() emit SDKPartialAssistantMessage (streaming deltas)?
 *   2. Can we send a system prompt via the control initialization path?
 *   3. What's the latency difference between cold query() and warm session.send()?
 *   4. Does the session survive multiple send/stream cycles?
 *
 * Usage: npx tsx experiments/claude-inference-pipe/run-warm.ts [--verbose]
 */

import {
  unstable_v2_createSession,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKSession } from "@anthropic-ai/claude-agent-sdk";

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

function collectMessageTypes(messages: SDKMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    let key = m.type;
    if (m.type === "stream_event") {
      key = `stream_event:${(m as { event: { type: string } }).event.type}`;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Test 11: V2 Session Basic Creation and Messaging
// ---------------------------------------------------------------------------

async function test11_sessionBasic(): Promise<boolean> {
  hr("Test 11: V2 Session Creation and Basic Messaging");
  console.log("  Create a V2 session, send a message, consume the stream.");
  console.log("  Verify: session creates, message sends, stream yields results.\n");

  const bootStart = Date.now();

  let session: SDKSession;
  try {
    session = unstable_v2_createSession({
      model: MODEL,
      permissionMode: "plan",
    });
    pass("Session created (no error thrown)");
  } catch (error) {
    fail("Session creation failed", String(error));
    return false;
  }

  const bootTime = Date.now() - bootStart;
  info("Session creation time", `${bootTime}ms`);

  // Send first message
  const sendStart = Date.now();
  try {
    await session.send("What is 2 + 2? Answer in one word.");
  } catch (error) {
    fail("session.send() failed", String(error));
    session.close();
    return false;
  }
  const sendTime = Date.now() - sendStart;
  info("send() time", `${sendTime}ms`);

  // Consume stream
  const streamStart = Date.now();
  const messages: SDKMessage[] = [];
  let resultText = "";

  try {
    for await (const msg of session.stream()) {
      messages.push(msg);
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = (msg as { result: string }).result;
      }
    }
  } catch (error) {
    fail("stream() iteration failed", String(error));
    session.close();
    return false;
  }

  const streamTime = Date.now() - streamStart;
  info("stream() time", `${streamTime}ms`);
  info("Total messages", messages.length);
  info("Result text", `"${resultText.trim()}"`);

  // Analyze message types
  const typeCounts = collectMessageTypes(messages);
  console.log("\n  Message types received:");
  for (const [type, count] of typeCounts) {
    console.log(`    ${type}: ${count}`);
  }

  // Check for streaming deltas
  const hasStreamEvents = messages.some((m) => m.type === "stream_event");
  const hasAssistant = messages.some((m) => m.type === "assistant");
  const hasResult = messages.some((m) => m.type === "result");

  console.log();
  hasStreamEvents
    ? pass("SDKPartialAssistantMessage (stream_event) received in V2 session")
    : fail("No stream_event messages (V2 session does NOT emit streaming deltas)");
  hasAssistant ? pass("SDKAssistantMessage received") : fail("No assistant message");
  hasResult ? pass("SDKResultMessage received") : fail("No result message");

  // Get session ID
  try {
    info("Session ID", session.sessionId);
    pass("sessionId accessible");
  } catch {
    info("Session ID", "not available");
  }

  session.close();
  return hasResult;
}

// ---------------------------------------------------------------------------
// Test 12: Warm Session Latency (Multiple Send/Stream Cycles)
// ---------------------------------------------------------------------------

async function test12_warmLatency(): Promise<boolean> {
  hr("Test 12: Warm Session Latency (Multi-Turn)");
  console.log("  Create one session, send 3 messages sequentially.");
  console.log("  Measure per-message latency to quantify warm vs cold overhead.\n");

  const bootStart = Date.now();
  const session = unstable_v2_createSession({
    model: MODEL,
    permissionMode: "plan",
  });

  const prompts = [
    "What is 2 + 2? One word.",
    "What is 3 + 3? One word.",
    "What is 4 + 4? One word.",
  ];

  const measurements: { prompt: string; sendMs: number; streamMs: number; totalMs: number; text: string }[] = [];

  for (const prompt of prompts) {
    const turnStart = Date.now();

    await session.send(prompt);
    const afterSend = Date.now();

    let resultText = "";
    let hasStreaming = false;
    for await (const msg of session.stream()) {
      if (msg.type === "stream_event") hasStreaming = true;
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = (msg as { result: string }).result;
      }
    }
    const afterStream = Date.now();

    measurements.push({
      prompt,
      sendMs: afterSend - turnStart,
      streamMs: afterStream - afterSend,
      totalMs: afterStream - turnStart,
      text: resultText.trim(),
    });
  }

  const bootMs = Date.now() - bootStart;

  // Report
  info("Session boot to first send", `${measurements[0]?.sendMs}ms`);
  console.log();

  for (let i = 0; i < measurements.length; i++) {
    const m = measurements[i];
    const label = i === 0 ? "(cold)" : `(warm ${i})`;
    info(`Turn ${i + 1} ${label}`, `send=${m.sendMs}ms  stream=${m.streamMs}ms  total=${m.totalMs}ms  response="${m.text}"`);
  }

  console.log();
  info("Total session time", `${bootMs}ms`);

  // Compare cold vs warm
  if (measurements.length >= 2) {
    const coldTotal = measurements[0].totalMs;
    const warmTotal = measurements[1].totalMs;
    const warmTotal2 = measurements.length > 2 ? measurements[2].totalMs : warmTotal;
    const avgWarm = Math.round((warmTotal + warmTotal2) / 2);

    info("Cold (first call)", `${coldTotal}ms`);
    info("Warm (avg subsequent)", `${avgWarm}ms`);
    info("Speedup", `${(coldTotal / avgWarm).toFixed(1)}x`);

    if (avgWarm < coldTotal * 0.7) {
      pass(`Warm sessions are ${(coldTotal / avgWarm).toFixed(1)}x faster than cold`);
    } else {
      info("NOTE", "Warm session speedup is marginal (may be dominated by API time)");
    }
  }

  // Also run a cold query() for direct comparison
  console.log();
  info("Baseline comparison", "Running cold query() for reference...");
  const coldStart = Date.now();
  const q = query({
    prompt: "What is 5 + 5? One word.",
    options: {
      model: MODEL,
      tools: [],
      maxTurns: 1,
      persistSession: false,
    },
  });
  let coldText = "";
  for await (const msg of q) {
    if (msg.type === "result" && msg.subtype === "success") {
      coldText = (msg as { result: string }).result;
    }
  }
  const coldMs = Date.now() - coldStart;
  info("Cold query() baseline", `${coldMs}ms  response="${coldText.trim()}"`);

  if (measurements.length >= 2) {
    const warmAvg = Math.round(
      (measurements[1].totalMs + (measurements[2]?.totalMs ?? measurements[1].totalMs)) / 2,
    );
    info("Warm session vs cold query()", `${warmAvg}ms vs ${coldMs}ms = ${(coldMs / warmAvg).toFixed(1)}x improvement`);
  }

  session.close();
  return measurements.length === 3;
}

// ---------------------------------------------------------------------------
// Test 13: Session Stream Event Types Audit
// ---------------------------------------------------------------------------

async function test13_streamEventAudit(): Promise<boolean> {
  hr("Test 13: Detailed Stream Event Type Audit");
  console.log("  Exhaustive catalog of every SDK message type emitted by V2 session.\n");

  const session = unstable_v2_createSession({
    model: MODEL,
    permissionMode: "plan",
  });

  await session.send("Write a two-line poem about code.");

  const messages: SDKMessage[] = [];
  for await (const msg of session.stream()) {
    messages.push(msg);
  }

  // Detailed breakdown
  console.log(`  Total messages: ${messages.length}\n`);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let detail = `type="${msg.type}"`;

    if (msg.type === "stream_event") {
      const event = (msg as { event: { type: string } }).event;
      detail += ` event="${event.type}"`;
      if (event.type === "content_block_delta") {
        const delta = (event as { delta?: { type: string } }).delta;
        detail += ` delta="${delta?.type}"`;
      }
    } else if (msg.type === "result") {
      detail += ` subtype="${(msg as { subtype: string }).subtype}"`;
    } else if (msg.type === "system") {
      detail += ` subtype="${(msg as { subtype: string }).subtype}"`;
    }

    if (VERBOSE) {
      console.log(`  [${i}] ${detail}`);
    }
  }

  // Summary
  const typeCounts = collectMessageTypes(messages);
  console.log("\n  Type summary:");
  for (const [type, count] of [...typeCounts.entries()].sort()) {
    console.log(`    ${type}: ${count}`);
  }

  // Key checks
  const streamEventCount = messages.filter((m) => m.type === "stream_event").length;
  const hasContentBlockDelta = messages.some(
    (m) => m.type === "stream_event" && (m as { event: { type: string } }).event.type === "content_block_delta",
  );

  console.log();
  streamEventCount > 0
    ? pass(`${streamEventCount} stream_event messages (V2 sessions DO emit streaming deltas)`)
    : fail("Zero stream_event messages (V2 sessions do NOT emit streaming deltas)");
  hasContentBlockDelta
    ? pass("content_block_delta events present (text streaming works)")
    : fail("No content_block_delta events");

  // Extract text from stream events to verify translation viability
  let streamedText = "";
  for (const msg of messages) {
    if (msg.type === "stream_event") {
      const event = (msg as { event: { type: string; delta?: { type: string; text?: string } } }).event;
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        streamedText += event.delta.text ?? "";
      }
    }
  }
  if (streamedText.length > 0) {
    pass(`Streamed text from V2 session: "${streamedText.substring(0, 80)}..."`);
  }

  session.close();
  return streamEventCount > 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Claude Code SDK V2 Warm Session Experiment                 ║");
  console.log("║  Phase 3: Can warm sessions power Pi inference at boot?     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  info("Model", MODEL);
  info("SDK", "@anthropic-ai/claude-agent-sdk (unstable_v2_createSession)");
  info("Date", new Date().toISOString());
  info("Verbose", VERBOSE);

  const results: { name: string; passed: boolean }[] = [];

  const tests = [
    { name: "Session Basic", fn: test11_sessionBasic },
    { name: "Warm Latency", fn: test12_warmLatency },
    { name: "Stream Event Audit", fn: test13_streamEventAudit },
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
  hr("PHASE 3 EXPERIMENT SUMMARY");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  for (const r of results) {
    console.log(`  ${r.passed ? "[PASS]" : "[FAIL]"} ${r.name}`);
  }

  console.log();
  console.log(`  Result: ${passed}/${total} tests passed`);
  console.log();

  if (results.every((r) => r.passed)) {
    console.log("  WARM SESSIONS VIABLE. V2 sessions can serve as always-on");
    console.log("  inference backends from PanCode boot. Subprocess overhead is");
    console.log("  paid once. Subsequent calls hit API latency only.");
  } else if (results.some((r) => r.passed)) {
    console.log("  PARTIALLY VIABLE. Some warm session features work.");
    console.log("  Review failed tests for specific limitations.");
  } else {
    console.log("  WARM SESSIONS NOT VIABLE in current SDK state.");
    console.log("  Fall back to cold query() per inference call.");
  }

  console.log();
  process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(2);
});
