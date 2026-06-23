/**
 * Transporte HTTP: monta a requisição, injeta auth, e — crucialmente —
 * distingue resposta de STREAM de resposta de ERRO antes de qualquer parsing.
 *
 * Erros pré-stream (401/403/404/409/400/5xx) NÃO vêm como SSE: voltam como JSON
 * `{ error, message }` com status normal (ver as rotas `/stream` do volund-os).
 * Por isso checamos `ok` + `content-type` aqui; só uma resposta
 * `text/event-stream` de fato é devolvida para virar um `Run`.
 */

import { errorFromApiResponse, VolundError } from "./errors";
import type { VolundFileInput } from "./protocol/events";

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  /** Headers extra em toda requisição (ex.: bypass de proteção da Vercel). */
  defaultHeaders?: Record<string, string>;
}

export interface StreamRequestBody {
  input: string;
  files?: VolundFileInput[];
}

/**
 * Faz POST num endpoint `/stream` e devolve a `Response` SSE crua. Lança a
 * subclasse de `VolundError` apropriada se a resposta for um erro.
 */
export async function postStream(
  cfg: HttpConfig,
  path: string,
  body: StreamRequestBody,
  signal?: AbortSignal
): Promise<Response> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}${path}`;

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
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    throw new VolundError(
      `Falha de rede ao chamar ${path}.`,
      { code: "network_error", cause }
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (res.ok && contentType.includes("text/event-stream")) {
    return res;
  }

  // Caminho de erro: tenta ler `{ error, message }`; se não for JSON, sintetiza.
  let payload: { error?: string; message?: string } = {};
  try {
    payload = (await res.json()) as { error?: string; message?: string };
  } catch {
    payload = { message: `Resposta inesperada (HTTP ${res.status}).` };
  }
  throw errorFromApiResponse(res.status, payload);
}
