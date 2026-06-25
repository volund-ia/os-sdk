import { describe, expect, it } from "vitest";

import { VolundOS } from "../src/client";
import type { VolundEvent } from "../src/protocol/events";

// --- helpers -------------------------------------------------------------

const enc = new TextEncoder();
const frame = (e: VolundEvent) => `data: ${JSON.stringify(e)}\n\n`;

/** Response SSE de um wire que fecha sozinho (servidor encerra o stream). */
function closedSse(wire: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(wire));
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * Response SSE "viva": entrega `firstFrame` e, no pull seguinte, erra com
 * AbortError — simulando o que o fetch faz quando a conexão é abortada.
 */
function liveSse(firstFrame: string): Response {
  let n = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      n++;
      if (n === 1) c.enqueue(enc.encode(firstFrame));
      else c.error(new DOMException("aborted", "AbortError"));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** fetch falso que captura o `signal` entregue ao fetch e devolve a Response dada. */
function fetchCapturingSignal(res: Response) {
  const captured: { signal?: AbortSignal } = {};
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured.signal = init?.signal ?? undefined;
    return res;
  }) as typeof fetch;
  return { fetch: fn, captured };
}

const RUN_STARTED = frame({ type: "run_started", protocol: "v1", run_id: "t_1", agent_id: "a" });
const TEXT = frame({ type: "assistant_text_delta", delta: "oi" });
const FINISHED = frame({ type: "run_finished", status: "completed", output: "oi", usage: null });
const AWAITING = frame({ type: "awaiting_input", request_id: "req_1", kind: "vault" });

// --- testes --------------------------------------------------------------

describe("Run — teardown da conexão", () => {
  it("aborta a conexão se o consumidor sai no MEIO (sem evento terminal)", async () => {
    const { fetch, captured } = fetchCapturingSignal(closedSse(RUN_STARTED + TEXT + FINISHED));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    for await (const ev of run.stream()) {
      if (ev.type === "run_started") break; // abandona antes do run_finished
    }

    expect(captured.signal?.aborted).toBe(true); // conexão fechada → servidor mata o sandbox
  });

  it("NÃO aborta quando o stream termina em awaiting_input (preserva resume do vault)", async () => {
    const { fetch, captured } = fetchCapturingSignal(closedSse(RUN_STARTED + AWAITING));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    const seen: string[] = [];
    for await (const ev of run.stream()) seen.push(ev.type);

    expect(seen).toEqual(["run_started", "awaiting_input"]);
    expect(captured.signal?.aborted).toBe(false); // run parqueado p/ vault NÃO é morto
  });

  it("NÃO aborta no fim normal (run_finished)", async () => {
    const { fetch, captured } = fetchCapturingSignal(closedSse(RUN_STARTED + TEXT + FINISHED));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    for await (const _ of run.stream()) void _; // consome tudo
    expect(captured.signal?.aborted).toBe(false);
  });

  it("run.cancel() no meio encerra o for await sem lançar", async () => {
    const { fetch } = fetchCapturingSignal(liveSse(RUN_STARTED));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    const seen: string[] = [];
    let threw = false;
    try {
      for await (const ev of run.stream()) {
        seen.push(ev.type);
        if (ev.type === "run_started") run.cancel(); // cancela durante o voo
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false); // AbortError do nosso cancel é engolido
    expect(seen).toEqual(["run_started"]);
  });
});
