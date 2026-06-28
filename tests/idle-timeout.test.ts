import { describe, expect, it } from "vitest";

import { parseVolundSSE } from "../src/sse";
import { VolundOS } from "../src/client";
import type { VolundEvent } from "../src/protocol/events";

/**
 * TDD — Item 3 do backlog §3.5: `idleTimeoutMs`.
 *
 * Aborta o stream se NENHUM byte (evento OU heartbeat `: ping`) chegar dentro de
 * `idleTimeoutMs`. É diferente do `timeoutMs` (que cobre só a fase pré-stream).
 * Heartbeats RESETAM o ocioso (run saudável mas quieto não pode ser morto).
 *
 * Testes usam timers reais com atrasos curtos (≤250ms) — determinísticos.
 */

const enc = new TextEncoder();
const frame = (e: VolundEvent) => `data: ${JSON.stringify(e)}\n\n`;
const RUN_STARTED = frame({ type: "run_started", protocol: "v1", run_id: "t1", agent_id: "a" });
const FINISHED = frame({ type: "run_finished", status: "completed", output: "ok", usage: null });

/** Stream que enfileira pedaços em instantes agendados (ms) e fecha ao final. */
function timedStream(
  steps: Array<{ at: number; text?: string }>,
  closeAt: number
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const s of steps) {
        setTimeout(() => {
          if (s.text) {
            try {
              controller.enqueue(enc.encode(s.text));
            } catch {
              /* já fechado */
            }
          }
        }, s.at);
      }
      setTimeout(() => {
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      }, closeAt);
    },
  });
}

async function collect(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs?: number
): Promise<VolundEvent[]> {
  const out: VolundEvent[] = [];
  const opts = idleTimeoutMs !== undefined ? { idleTimeoutMs } : {};
  for await (const ev of parseVolundSSE(body, opts)) out.push(ev);
  return out;
}

describe("parseVolundSSE — idle timeout", () => {
  it("dispara timeout quando fica ocioso além de idleTimeoutMs", async () => {
    // run_started em 0, e NADA até o close em 250. Com idle=60, deve estourar ~60.
    const body = timedStream([{ at: 0, text: RUN_STARTED }], 250);
    await expect(collect(body, 60)).rejects.toMatchObject({ code: "timeout" });
  });

  it("heartbeats `: ping` RESETAM o ocioso (run quieto mas saudável não morre)", async () => {
    // pings a cada 40ms < idle(80); run_finished em 170; close 200. Não deve estourar.
    const body = timedStream(
      [
        { at: 0, text: RUN_STARTED },
        { at: 40, text: ": ping\n\n" },
        { at: 80, text: ": ping\n\n" },
        { at: 120, text: ": ping\n\n" },
        { at: 160, text: ": ping\n\n" },
        { at: 170, text: FINISHED },
      ],
      200
    );
    const events = await collect(body, 80);
    expect(events.map((e) => e.type)).toEqual(["run_started", "run_finished"]);
  });

  it("sem idleTimeoutMs, nunca dispara mesmo com silêncio longo", async () => {
    // gap de 150ms sem nada, mas idle desativado → completa normal.
    const body = timedStream(
      [
        { at: 0, text: RUN_STARTED },
        { at: 150, text: FINISHED },
      ],
      180
    );
    const events = await collect(body); // sem idleTimeoutMs
    expect(events.map((e) => e.type)).toEqual(["run_started", "run_finished"]);
  });
});

describe("VolundOS — idleTimeoutMs ponta a ponta", () => {
  it("estoura timeout no consumidor E aborta a conexão (fecha → mata sandbox)", async () => {
    let captured: AbortSignal | undefined;
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      captured = init?.signal ?? undefined;
      const body = timedStream([{ at: 0, text: RUN_STARTED }], 300); // depois fica ocioso
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const volund = new VolundOS({ apiKey: "k", fetch: fetchImpl, idleTimeoutMs: 60 });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    let thrown: unknown;
    try {
      for await (const _ of run.stream()) void _;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: "timeout" });
    expect(captured?.aborted).toBe(true); // conexão foi fechada
  });
});
