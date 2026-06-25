/**
 * Transporte HTTP: monta a requisição, injeta auth, e — crucialmente —
 * distingue resposta de STREAM de resposta de ERRO antes de qualquer parsing.
 *
 * Erros pré-stream (401/403/404/409/400/5xx) NÃO vêm como SSE: voltam como JSON
 * `{ error, message }` com status normal (ver as rotas `/stream` do volund-os).
 * Por isso checamos `ok` + `content-type` aqui; só uma resposta
 * `text/event-stream` de fato é devolvida para virar um `Run`.
 *
 * Robustez (v0.2):
 *  - TIMEOUT cobre só a fase PRÉ-STREAM (até a resposta/headers chegarem). NÃO
 *    limita a duração do stream — um run pode durar minutos. Assim que a resposta
 *    chega, o timer é cancelado; o sinal de cancelamento do usuário continua
 *    ligado ao fetch p/ `run.cancel()` abortar o stream a qualquer momento.
 *  - RETRY com backoff exponencial só na fase pré-stream e só p/ erro de rede e
 *    5xx (nunca 4xx, que são determinísticos). ⚠️ `run`/`continue` NÃO são
 *    idempotentes: um 5xx pode ter criado o run mesmo assim. Por isso o default
 *    é conservador e o retry é desligável (`maxRetries: 0`).
 */

import { errorFromApiResponse, VolundError } from "./errors";
import type { VolundFileInput } from "./protocol/events";

/** Timeout default (ms) p/ receber a resposta. 0 desliga. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Tentativas extras default em erro de rede/5xx. */
export const DEFAULT_MAX_RETRIES = 2;
/** Base do backoff exponencial (ms): 300, 600, 1200... */
const RETRY_BASE_MS = 300;

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  /** Headers extra em toda requisição (ex.: bypass de proteção da Vercel). */
  defaultHeaders?: Record<string, string>;
  /** Timeout (ms) p/ receber a resposta. Default 60s. 0 desliga. */
  timeoutMs?: number;
  /** Tentativas extras em erro de rede/5xx. Default 2. 0 desliga. */
  maxRetries?: number;
  /** Sleep injetável (testes). Default: setTimeout real. */
  sleep?: (ms: number) => Promise<void>;
}

export interface StreamRequestBody {
  input: string;
  files?: VolundFileInput[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Combina o sinal externo (cancel do usuário) com um timeout. O fetch recebe o
 * sinal combinado. `clearTimer()` desarma o timeout (chame ao receber a resposta,
 * p/ o timer não abortar o stream em andamento); a ligação com o sinal externo
 * permanece, então `run.cancel()` segue funcionando durante todo o stream.
 */
function linkAbort(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

  return {
    signal: controller.signal,
    /** Foi o timeout (e não o cancel do usuário) que abortou? */
    timedOut: () => timedOut,
    /** Desarma o timeout sem soltar a ligação com o sinal externo. */
    clearTimer: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * Faz POST num endpoint `/stream` e devolve a `Response` SSE crua. Lança a
 * subclasse de `VolundError` apropriada se a resposta for um erro. Aplica timeout
 * pré-stream e retry (rede/5xx) conforme a config.
 */
export async function postStream(
  cfg: HttpConfig,
  path: string,
  body: StreamRequestBody,
  signal?: AbortSignal
): Promise<Response> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}${path}`;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = cfg.sleep ?? defaultSleep;
  const payload = JSON.stringify(body);

  let lastError: VolundError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Cancelamento já pedido antes de tentar: respeita na hora.
    if (signal?.aborted) {
      throw new VolundError(`Requisição a ${path} cancelada.`, {
        code: "network_error",
        cause: signal.reason,
      });
    }

    const link = linkAbort(signal, timeoutMs);
    let res: Response;
    try {
      res = await cfg.fetch(url, {
        method: "POST",
        headers: {
          // defaultHeaders primeiro: os obrigatórios sempre vencem (não dá p/
          // quebrar auth/streaming por engano), mas extras como bypass passam.
          ...cfg.defaultHeaders,
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: payload,
        signal: link.signal,
      });
    } catch (cause) {
      // Resposta nunca chegou. Timeout do usuário? cancel? falha de transporte?
      link.clearTimer();
      if (link.timedOut()) {
        lastError = new VolundError(
          `Timeout (${timeoutMs}ms) esperando resposta de ${path}.`,
          { code: "timeout", cause }
        );
      } else if (signal?.aborted) {
        // Cancel do usuário — não é retentável.
        throw new VolundError(`Requisição a ${path} cancelada.`, {
          code: "network_error",
          cause,
        });
      } else {
        lastError = new VolundError(`Falha de rede ao chamar ${path}.`, {
          code: "network_error",
          cause,
        });
      }
      if (attempt < maxRetries) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    // Resposta chegou: desarma o timeout para não matar o stream que vem a seguir.
    link.clearTimer();

    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.includes("text/event-stream")) {
      return res;
    }

    // Caminho de erro: tenta ler `{ error, message }`; se não for JSON, sintetiza.
    let errBody: { error?: string; message?: string } = {};
    try {
      errBody = (await res.json()) as { error?: string; message?: string };
    } catch {
      errBody = { message: `Resposta inesperada (HTTP ${res.status}).` };
    }
    const mapped = errorFromApiResponse(res.status, errBody);

    // Só 5xx é retentável. 4xx é determinístico — falha na hora.
    if (res.status >= 500 && attempt < maxRetries) {
      lastError = mapped;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
      continue;
    }
    throw mapped;
  }

  // Inalcançável na prática (o loop sempre retorna ou lança), mas satisfaz o tipo.
  throw lastError ?? new VolundError(`Falha ao chamar ${path}.`, { code: "network_error" });
}
