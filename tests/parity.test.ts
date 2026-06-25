import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseVolundSSE } from "../src/sse";
import type { VolundEvent } from "../src/protocol/events";

/**
 * Teste de PARIDADE ponta-a-ponta (task 2.3).
 *
 * `tests/fixtures/weather-run.events.json` é a sequência canônica de `VolundEvent`
 * que o adapter do servidor produz a partir de `fixture.ndjson` — copiada verbatim
 * da asserção fonte-da-verdade em `volund-os`:
 *   lib/agent/connectors/api/sse-adapter.test.ts
 *   ("fixture.ndjson → sequência completa de VolundEvent").
 *
 * Aqui reproduzimos o WIRE exatamente como a camada de transporte do servidor o
 * emite (`adaptClaudeToVolundSSE`: `id:` incremental a partir de 0 + `data: <json>`,
 * com heartbeats `: ping` intercalados — ver sse-adapter.transport.test.ts) e
 * afirmamos que `parseVolundSSE` reconstrói a MESMA sequência. Isso prende o parser
 * do SDK ao formato real do servidor (snake_case, dedup do snapshot, etc.).
 *
 * Se este teste quebrar após um `npm run sync:protocol`, o contrato mudou: atualize
 * o fixture a partir da asserção do servidor.
 */

const FIXTURE = join(__dirname, "fixtures", "weather-run.events.json");

/** Eventos canônicos esperados (saída do adapter do servidor). */
const canonical = JSON.parse(readFileSync(FIXTURE, "utf8")) as VolundEvent[];

/** Serializa como a camada de transporte do servidor: `id: n` + `data: json`. */
function toServerWire(events: VolundEvent[]): string {
  return events.map((e, i) => `id: ${i}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

/** Quebra uma string em pedaços de tamanho fixo (simula chunks de rede). */
function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<VolundEvent[]> {
  const out: VolundEvent[] = [];
  for await (const ev of parseVolundSSE(body)) out.push(ev);
  return out;
}

describe("paridade com o wire do servidor (fixture)", () => {
  it("reconstrói a sequência canônica a partir do wire serializado", async () => {
    const wire = toServerWire(canonical);
    const got = await collect(streamFromChunks([wire]));
    expect(got).toEqual(canonical);
  });

  it("ignora heartbeats `: ping` intercalados entre os frames", async () => {
    const wire = canonical
      .map((e, i) => `: ping\nid: ${i}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    const got = await collect(streamFromChunks([wire]));
    expect(got).toEqual(canonical);
  });

  it("é robusto a frames partidos em chunks pequenos de rede", async () => {
    const wire = toServerWire(canonical);
    const got = await collect(streamFromChunks(chunk(wire, 7)));
    expect(got).toEqual(canonical);
  });
});
