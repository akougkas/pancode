/**
 * translate.ts
 *
 * Core translation layer: Claude Code SDK V2 streaming events to Pi-compatible
 * AssistantMessageEvent format.
 *
 * The Claude Code SDK V2 emits SDKPartialAssistantMessage events containing raw
 * BetaRawMessageStreamEvent objects from the Anthropic SDK. These are the SAME
 * event types that Pi's streamAnthropic() parses from the Anthropic SSE stream.
 *
 * This module translates them into Pi's AssistantMessageEvent format, proving
 * that Claude Code SDK V2 can serve as an inference backend for Pi Coding Agent.
 */

import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Pi-compatible types (standalone, no pi-ai dependency)
// These match the interfaces in @mariozechner/pi-ai/src/types.ts
// ---------------------------------------------------------------------------

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  args: string;
}

export type ContentBlock = TextContent | ThinkingContent | ToolCall;

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  api: string;
  provider: string;
  model: string;
  responseId?: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: StopReason; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// ---------------------------------------------------------------------------
// Translation infrastructure
// ---------------------------------------------------------------------------

function createEmptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createEmptyAssistantMessage(model: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "claude-code-sdk",
    provider: "claude-code",
    model,
    usage: createEmptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "toolUse";
    case "refusal":
      return "error";
    default:
      return "stop";
  }
}

/**
 * Snapshot the current AssistantMessage state for the partial field.
 * Pi's streaming events carry a snapshot of the accumulated state.
 */
function snapshot(msg: AssistantMessage): AssistantMessage {
  return {
    ...msg,
    content: msg.content.map((c) => ({ ...c })),
    usage: { ...msg.usage, cost: { ...msg.usage.cost } },
  };
}

// ---------------------------------------------------------------------------
// Core translation result type
// ---------------------------------------------------------------------------

export interface TranslationResult {
  /** All translated Pi-compatible events in emission order. */
  events: AssistantMessageEvent[];
  /** The accumulated final AssistantMessage (may be incomplete on error). */
  finalMessage: AssistantMessage;
  /** The SDK result message (contains cost, duration, usage aggregates). */
  sdkResult: SDKResultMessage | null;
  /** Non-fatal issues encountered during translation. */
  warnings: string[];
  /** SDK message types received (for debugging). */
  sdkMessageTypes: string[];
}

// ---------------------------------------------------------------------------
// The translator
// ---------------------------------------------------------------------------

/**
 * Consumes a Claude Code SDK V2 message stream and translates it to Pi's
 * AssistantMessageEvent format.
 *
 * This function collects all events into an array for inspection. In production,
 * the same logic would push events into an AssistantMessageEventStream instead.
 */
export async function translateSdkStream(
  sdkMessages: AsyncIterable<SDKMessage>,
  model: string,
): Promise<TranslationResult> {
  const events: AssistantMessageEvent[] = [];
  const output = createEmptyAssistantMessage(model);
  const warnings: string[] = [];
  const sdkMessageTypes: string[] = [];
  let sdkResult: SDKResultMessage | null = null;
  let startEmitted = false;

  for await (const msg of sdkMessages) {
    sdkMessageTypes.push(msg.type);

    if (msg.type === "stream_event") {
      const streamMsg = msg as SDKPartialAssistantMessage;
      const event = streamMsg.event;

      switch (event.type) {
        case "message_start": {
          // The message_start event carries the initial BetaMessage with usage.
          const betaMsg = (event as { message?: { id?: string; usage?: Record<string, number> } }).message;
          if (betaMsg?.usage) {
            output.usage.input = betaMsg.usage.input_tokens ?? 0;
            output.usage.cacheRead = betaMsg.usage.cache_read_input_tokens ?? 0;
            output.usage.cacheWrite = betaMsg.usage.cache_creation_input_tokens ?? 0;
          }
          if (betaMsg?.id) {
            output.responseId = betaMsg.id;
          }
          startEmitted = true;
          events.push({ type: "start", partial: snapshot(output) });
          break;
        }

        case "content_block_start": {
          const cbs = event as { content_block: { type: string; id?: string; name?: string }; index: number };
          const block = cbs.content_block;
          const index = cbs.index;

          if (block.type === "text") {
            output.content.push({ type: "text", text: "" });
            events.push({ type: "text_start", contentIndex: index, partial: snapshot(output) });
          } else if (block.type === "thinking") {
            output.content.push({ type: "thinking", thinking: "", signature: "" });
            events.push({ type: "thinking_start", contentIndex: index, partial: snapshot(output) });
          } else if (block.type === "tool_use") {
            output.content.push({
              type: "toolCall",
              id: block.id ?? "",
              name: block.name ?? "",
              args: "",
            });
            events.push({ type: "toolcall_start", contentIndex: index, partial: snapshot(output) });
          } else {
            warnings.push(`Unknown content block type: ${block.type} at index ${index}`);
          }
          break;
        }

        case "content_block_delta": {
          const cbd = event as { delta: { type: string; text?: string; thinking?: string; partial_json?: string; signature?: string }; index: number };
          const delta = cbd.delta;
          const index = cbd.index;
          const block = output.content[index];

          if (!block) {
            warnings.push(`content_block_delta for missing index ${index}`);
            break;
          }

          if (delta.type === "text_delta" && block.type === "text") {
            block.text += delta.text ?? "";
            events.push({
              type: "text_delta",
              contentIndex: index,
              delta: delta.text ?? "",
              partial: snapshot(output),
            });
          } else if (delta.type === "thinking_delta" && block.type === "thinking") {
            block.thinking += delta.thinking ?? "";
            events.push({
              type: "thinking_delta",
              contentIndex: index,
              delta: delta.thinking ?? "",
              partial: snapshot(output),
            });
          } else if (delta.type === "input_json_delta" && block.type === "toolCall") {
            block.args += delta.partial_json ?? "";
            events.push({
              type: "toolcall_delta",
              contentIndex: index,
              delta: delta.partial_json ?? "",
              partial: snapshot(output),
            });
          } else if (delta.type === "signature_delta" && block.type === "thinking") {
            block.signature += delta.signature ?? "";
            // No Pi event for signature deltas. Accumulated silently.
          } else if (delta.type === "citations_delta") {
            // Pi does not have a citations event. Skip.
          } else {
            warnings.push(`Unhandled delta type: ${delta.type} for block type: ${block.type}`);
          }
          break;
        }

        case "content_block_stop": {
          const cbStop = event as { index: number };
          const index = cbStop.index;
          const block = output.content[index];

          if (!block) {
            warnings.push(`content_block_stop for missing index ${index}`);
            break;
          }

          if (block.type === "text") {
            events.push({
              type: "text_end",
              contentIndex: index,
              content: block.text,
              partial: snapshot(output),
            });
          } else if (block.type === "thinking") {
            events.push({
              type: "thinking_end",
              contentIndex: index,
              content: block.thinking,
              partial: snapshot(output),
            });
          } else if (block.type === "toolCall") {
            events.push({
              type: "toolcall_end",
              contentIndex: index,
              toolCall: { ...block },
              partial: snapshot(output),
            });
          }
          break;
        }

        case "message_delta": {
          const md = event as { delta?: { stop_reason?: string }; usage?: { output_tokens?: number } };
          if (md.delta?.stop_reason) {
            output.stopReason = mapStopReason(md.delta.stop_reason);
          }
          if (md.usage?.output_tokens) {
            output.usage.output = md.usage.output_tokens;
            output.usage.totalTokens =
              output.usage.input + output.usage.output + output.usage.cacheRead;
          }
          break;
        }

        case "message_stop": {
          // Emit the final done event. This corresponds to the end of Pi's
          // for-await-of loop over the Anthropic SSE stream.
          events.push({
            type: "done",
            reason: output.stopReason,
            message: snapshot(output),
          });
          break;
        }

        default: {
          warnings.push(`Unknown stream event type: ${(event as { type: string }).type}`);
        }
      }
    } else if (msg.type === "assistant") {
      // Full SDKAssistantMessage. Use for validation (response ID confirmation).
      const assistantMsg = msg as SDKAssistantMessage;
      if (assistantMsg.message?.id) {
        output.responseId = assistantMsg.message.id;
      }
    } else if (msg.type === "result") {
      // SDKResultMessage. Extract cost and final usage.
      sdkResult = msg as SDKResultMessage;
      if (sdkResult.total_cost_usd !== undefined) {
        output.usage.cost.total = sdkResult.total_cost_usd;
      }
      if ("usage" in sdkResult && sdkResult.usage) {
        const u = sdkResult.usage as { input_tokens?: number; output_tokens?: number };
        if (u.input_tokens) output.usage.input = u.input_tokens;
        if (u.output_tokens) output.usage.output = u.output_tokens;
        output.usage.totalTokens =
          output.usage.input + output.usage.output + output.usage.cacheRead;
      }
    }
    // All other SDK message types (system, auth_status, rate_limit_event, etc.)
    // are ignored for inference translation. They are PanCode observability
    // concerns, not agent loop concerns.
  }

  // Edge case: if streaming events were received but no message_stop fired.
  if (startEmitted && !events.some((e) => e.type === "done" || e.type === "error")) {
    events.push({
      type: "done",
      reason: output.stopReason,
      message: snapshot(output),
    });
    warnings.push("No message_stop event received. Synthesized done event.");
  }

  // Edge case: no streaming events at all (includePartialMessages was false
  // or the query errored before streaming started).
  if (!startEmitted) {
    if (sdkResult && sdkResult.subtype === "success") {
      const successResult = sdkResult as SDKResultSuccess;
      output.content.push({ type: "text", text: successResult.result ?? "" });
      events.push({ type: "start", partial: snapshot(output) });
      events.push({
        type: "done",
        reason: "stop",
        message: snapshot(output),
      });
      warnings.push("No streaming events received. Reconstructed from SDK result.");
    } else {
      output.stopReason = "error";
      output.errorMessage = sdkResult
        ? `SDK error: ${sdkResult.subtype}`
        : "No streaming events and no SDK result received.";
      events.push({
        type: "error",
        reason: "error",
        error: snapshot(output),
      });
    }
  }

  return {
    events,
    finalMessage: output,
    sdkResult,
    warnings,
    sdkMessageTypes,
  };
}
