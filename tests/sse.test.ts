import { describe, expect, it } from "vitest";

import { parseVolundSSE } from "../src/sse";
import type { VolundEvent } from "../src/protocol/events";

/** Constrói um ReadableStream<Uint8Array> a partir de pedaços de texto. */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<VolundEvent[]> {
  const out: VolundEvent[] = [];
  for await (const ev of parseVolundSSE(body)) out.push(ev);
  return out;
}

const frame = (e: VolundEvent, id?: number) =>
  `${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(e)}\n\n`;

describe("parseVolundSSE", () => {
  it("parseia uma sequência completa em ordem", async () => {
    const wire =
      frame({ type: "run_started", protocol: "v1", run_id: "t1", agent_id: "agt_1" }, 0) +
      frame({ type: "assistant_text_delta", delta: "Olá" }, 1) +
      frame({ type: "assistant_text_delta", delta: " mundo" }, 2) +
      frame(
        { type: "run_finished", status: "completed", output: "Olá mundo", usage: null },
        3
      );
    const events = await collect(streamFromChunks([wire]));
    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "assistant_text_delta",
      "assistant_text_delta",
      "run_finished",
    ]);
  });

  it("ignora heartbeats (`: ping`)", async () => {
    const wire =
      ": ping\n\n" +
      frame({ type: "assistant_text_delta", delta: "a" }) +
      ": ping\n\n" +
      frame({ type: "run_finished", status: "completed", output: "a", usage: null });
    const events = await collect(streamFromChunks([wire]));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "assistant_text_delta", delta: "a" });
  });

  it("lida com frames partidos no meio entre chunks de rede", async () => {
    const full = frame({ type: "assistant_text_delta", delta: "streaming" }, 7);
    const cut = Math.floor(full.length / 2);
    // Quebra o frame ao meio (o caso clássico que quebra parser ingênuo).
    const events = await collect(streamFromChunks([full.slice(0, cut), full.slice(cut)]));
    expect(events).toEqual([{ type: "assistant_text_delta", delta: "streaming" }]);
  });

  it("preserva ordem com `data:` chegando byte a byte", async () => {
    const wire = frame({ type: "tool_call", tool_call_id: "c1", tool_name: "bash", input: { cmd: "ls" } });
    const events = await collect(streamFromChunks([...wire])); // 1 char por chunk
    expect(events).toEqual([
      { type: "tool_call", tool_call_id: "c1", tool_name: "bash", input: { cmd: "ls" } },
    ]);
  });

  it("ignora tipos desconhecidos (forward-compat) e JSON malformado", async () => {
    const wire =
      `data: ${JSON.stringify({ type: "futuro_desconhecido", x: 1 })}\n\n` +
      "data: {isto não é json}\n\n" +
      frame({ type: "run_finished", status: "completed", output: "", usage: null });
    const events = await collect(streamFromChunks([wire]));
    expect(events.map((e) => e.type)).toEqual(["run_finished"]);
  });

  it("emite awaiting_input quando o run pausa (vault)", async () => {
    const wire = frame({ type: "awaiting_input", request_id: "req_9", kind: "vault" });
    const events = await collect(streamFromChunks([wire]));
    expect(events[0]).toEqual({ type: "awaiting_input", request_id: "req_9", kind: "vault" });
  });
});
