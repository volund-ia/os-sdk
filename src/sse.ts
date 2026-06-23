/**
 * Parser SSE → `VolundEvent`. Camada fina sobre `eventsource-parser`, o mesmo
 * parser usado pelo Vercel AI SDK e pelo SDK da OpenAI. Ele resolve, de graça,
 * as três armadilhas do wire do Volund OS (ver `sse-adapter.ts` no servidor):
 *
 *   1. Heartbeat `: ping\n\n` — linhas de comentário são ignoradas pelo parser.
 *   2. Campo `id: <n>` por frame — exposto como `event.id` (reservado p/
 *      reconexão na V2); a V1 não o usa.
 *   3. `data:` multi-linha / partido entre chunks — o parser bufferiza e
 *      concatena conforme a spec SSE.
 *
 * Cada `event.data` é um JSON de um único `VolundEvent`. JSON inválido ou tipo
 * desconhecido é IGNORADO (regra de ouro [D4]: clientes ignoram o que não
 * conhecem — permite minor bumps sem quebrar).
 *
 * Usamos a API de callback (`createParser`) + um reader manual em vez do
 * `EventSourceParserStream` para evitar o atrito de variância de tipos entre
 * `TextDecoderStream` e `ReadableStream<Uint8Array>` no `lib.dom`.
 */

import { createParser } from "eventsource-parser";

import type { VolundEvent, VolundEventType } from "./protocol/events";

const KNOWN_TYPES: ReadonlySet<VolundEventType> = new Set<VolundEventType>([
  "run_started",
  "thinking_delta",
  "assistant_text_delta",
  "tool_call",
  "tool_result",
  "awaiting_input",
  "run_finished",
]);

function isVolundEvent(value: unknown): value is VolundEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    KNOWN_TYPES.has((value as { type: string }).type as VolundEventType)
  );
}

/**
 * Transforma o corpo de uma resposta `text/event-stream` numa sequência de
 * `VolundEvent`. Web-standard: roda em Node ≥18, Deno, Bun, Workers e browser.
 */
export async function* parseVolundSSE(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<VolundEvent> {
  const queue: VolundEvent[] = [];
  const parser = createParser({
    onEvent(event) {
      if (!event.data) return; // comentário/heartbeat ou frame vazio
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return; // frame malformado — ignora
      }
      if (isVolundEvent(parsed)) queue.push(parsed);
    },
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      // onEvent já rodou (síncrono) durante feed() — drena o que acumulou.
      while (queue.length > 0) yield queue.shift() as VolundEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
