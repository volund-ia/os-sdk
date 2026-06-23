/**
 * `volund.agents` — dispara (`run`) e continua (`continue`) execuções de agente.
 * DX espelha o Cursor SDK: `agents.run(...)` → `Run` com `.stream()/.result()`.
 */

import { VolundError } from "./errors";
import { postStream, type HttpConfig, type StreamRequestBody } from "./http";
import { Run } from "./run";
import type { ContinueInput, ExecutionMode, RunInput } from "./protocol/events";

/** Opções de `agents.run`. Estende o contrato do wire com `signal` (runtime). */
export type RunOptions = RunInput & { signal?: AbortSignal };
/** Opções de `agents.continue`. */
export type ContinueOptions = ContinueInput & { signal?: AbortSignal };

/** Combina o sinal do usuário com o sinal interno de `run.cancel()`. */
function linkSignals(controller: AbortController, external?: AbortSignal): void {
  if (!external) return;
  if (external.aborted) {
    controller.abort();
    return;
  }
  external.addEventListener("abort", () => controller.abort(), { once: true });
}

/** V1 só roda na nuvem; o gancho `execution` já existe p/ a V2 (local.cwd). */
function assertCloud(execution: ExecutionMode | undefined): void {
  if (execution && execution !== "cloud") {
    throw new VolundError(
      'execution: "local" ainda não é suportado (chega na V2). Use "cloud" ou omita.',
      { code: "unsupported" }
    );
  }
}

export class Agents {
  #http: HttpConfig;

  constructor(http: HttpConfig) {
    this.#http = http;
  }

  /** Dispara um run novo (cria uma thread) e devolve um `Run` em streaming. */
  async run(options: RunOptions): Promise<Run> {
    assertCloud(options.execution);
    const controller = new AbortController();
    linkSignals(controller, options.signal);

    const body: StreamRequestBody = { input: options.input };
    if (options.files?.length) body.files = options.files;

    const res = await postStream(
      this.#http,
      `/api/v1/agents/${encodeURIComponent(options.agentId)}/stream`,
      body,
      controller.signal
    );
    return new Run(res, runIdFromResponse(res), controller);
  }

  /** Continua uma conversa existente (mesma thread). */
  async continue(options: ContinueOptions): Promise<Run> {
    assertCloud(options.execution);
    const controller = new AbortController();
    linkSignals(controller, options.signal);

    const body: StreamRequestBody = { input: options.input };
    if (options.files?.length) body.files = options.files;

    const res = await postStream(
      this.#http,
      `/api/v1/runs/${encodeURIComponent(options.runId)}/stream`,
      body,
      controller.signal
    );
    return new Run(res, options.runId, controller);
  }
}

/**
 * Para um run NOVO o `run_id` só existe no primeiro evento (`run_started`) — o
 * servidor não o devolve em header. Então iniciamos o `Run` com "" e ele faz o
 * backfill do id ao consumir o `run_started` (ver `Run.stream`). Mantemos um
 * fast-path opcional por header caso o servidor passe a ecoá-lo no futuro.
 */
function runIdFromResponse(res: Response): string {
  return res.headers.get("x-volund-run-id") ?? "";
}
