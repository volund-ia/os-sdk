/**
 * `Run` — uma execução de agente em andamento. Espelha o `run` do Cursor SDK:
 * `.stream()` (eventos ao vivo), `.result()` (atalho p/ o texto final) e
 * `.cancel()` (fecha a conexão; o servidor mata a sandbox).
 */

import {
  VolundAwaitingInputError,
  VolundError,
  VolundRunFailedError,
} from "./errors";
import { parseVolundSSE } from "./sse";
import type { VolundEvent } from "./protocol/events";

export interface RunResult {
  /** Texto final do agente. */
  output: string;
  usage: { input_tokens?: number; output_tokens?: number } | null;
}

export class Run {
  #id: string;
  #response: Response;
  #abort: AbortController;
  #consumed = false;

  constructor(response: Response, id: string, abort: AbortController) {
    this.#response = response;
    this.#id = id;
    this.#abort = abort;
  }

  /**
   * `run_id` (== `thread_id` no Volund OS). Use em `agents.continue`.
   * Para um run NOVO, só fica disponível depois que o primeiro evento
   * (`run_started`) é consumido via `stream()`/`result()` — antes disso é "".
   * Em `agents.continue`, já vem preenchido (você passou o `runId`).
   */
  get id(): string {
    return this.#id;
  }

  /**
   * Itera os `VolundEvent` conforme chegam. ⚠️ Consumível UMA vez (é um stream
   * de rede) — não chame `stream()` e `result()` no mesmo `Run`.
   */
  async *stream(): AsyncIterable<VolundEvent> {
    if (this.#consumed) {
      throw new VolundError("Este run já foi consumido (stream/result só uma vez).", {
        code: "stream_error",
      });
    }
    this.#consumed = true;

    const body = this.#response.body;
    if (!body) {
      throw new VolundError("Resposta de streaming sem corpo legível.", {
        code: "stream_error",
      });
    }
    for await (const event of parseVolundSSE(body)) {
      // Para run novo, o id real chega aqui (run_started). Backfill barato.
      if (event.type === "run_started" && event.run_id) this.#id = event.run_id;
      yield event;
    }
  }

  /**
   * Espera o run terminar e devolve o texto final + uso de tokens.
   * Lança `VolundRunFailedError` se o run falhar e `VolundAwaitingInputError`
   * se ele pausar para HITL (vault). Para esses casos, prefira `stream()`.
   */
  async result(): Promise<RunResult> {
    let text = "";
    for await (const event of this.stream()) {
      switch (event.type) {
        case "assistant_text_delta":
          text += event.delta;
          break;
        case "awaiting_input":
          throw new VolundAwaitingInputError(event.request_id, event.kind);
        case "run_finished":
          if (event.status === "failed") {
            throw new VolundRunFailedError(
              event.error ?? "Run falhou sem motivo informado."
            );
          }
          return { output: event.output ?? text, usage: event.usage };
      }
    }
    // Stream terminou sem `run_finished` (ex.: conexão cortada). Devolve o que veio.
    return { output: text, usage: null };
  }

  /** Cancela o run: aborta a conexão → o servidor mata a sandbox. */
  cancel(): void {
    this.#abort.abort();
  }
}
