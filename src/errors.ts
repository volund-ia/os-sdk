/**
 * Hierarquia de erros do SDK. Espelha os códigos que a API já devolve em
 * `{ error, message }` (ver `VolundErrorCode` no contrato) e adiciona erros
 * locais do cliente (rede, stream, modo não suportado).
 *
 * Roteie SEMPRE por `instanceof` ou por `err.code` — nunca por `err.message`.
 */

import type { VolundErrorCode } from "./protocol/events";

/** Códigos locais do SDK que não vêm do servidor. */
export type VolundClientErrorCode =
  | "network_error" // falha de transporte (fetch rejeitou, DNS, offline)
  | "timeout" // resposta não chegou dentro de timeoutMs (fase pré-stream)
  | "stream_error" // corpo SSE ausente/ilegível, ou stream consumido 2x
  | "run_failed" // run_finished status:"failed"
  | "awaiting_input" // run pausou p/ HITL (vault) — ver AwaitingInputError
  | "unsupported"; // ex.: execution:"local" na V1

export type AnyVolundErrorCode = VolundErrorCode | VolundClientErrorCode;

export interface VolundErrorOptions {
  code: AnyVolundErrorCode;
  /** Status HTTP, quando o erro veio de uma resposta da API. */
  status?: number;
  cause?: unknown;
}

/** Erro base de todo o SDK. */
export class VolundError extends Error {
  readonly code: AnyVolundErrorCode;
  readonly status?: number;

  constructor(message: string, opts: VolundErrorOptions) {
    super(message, { cause: opts.cause });
    this.name = "VolundError";
    this.code = opts.code;
    this.status = opts.status;
    // Mantém a cadeia de protótipo correta após transpile p/ ES5/CJS.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 — chave ausente ou inválida. */
export class VolundAuthError extends VolundError {
  constructor(message: string, code: VolundErrorCode = "invalid_api_key", cause?: unknown) {
    super(message, { code, status: 401, cause });
    this.name = "VolundAuthError";
  }
}

/** 403 — a chave não tem acesso a este agente/run. */
export class VolundForbiddenError extends VolundError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "forbidden", status: 403, cause });
    this.name = "VolundForbiddenError";
  }
}

/** 404 — agente ou run inexistente. */
export class VolundNotFoundError extends VolundError {
  constructor(message: string, code: VolundErrorCode = "agent_not_found", cause?: unknown) {
    super(message, { code, status: 404, cause });
    this.name = "VolundNotFoundError";
  }
}

/** 409 — já existe um run ativo na thread (só na continuação). */
export class VolundRunBusyError extends VolundError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "run_busy", status: 409, cause });
    this.name = "VolundRunBusyError";
  }
}

/** O run terminou com `status: "failed"`. Lançado por `run.result()`. */
export class VolundRunFailedError extends VolundError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "run_failed", cause });
    this.name = "VolundRunFailedError";
  }
}

/**
 * O run pausou esperando ação humana (HITL): preenchimento de cofre (`vault`) ou
 * decisão de aprovação (`approval` — decida com `volund.approvals.approve/reject`).
 * `run.result()` lança isto porque o stream termina sem `run_finished`. Quem usa
 * `run.stream()` recebe o evento `awaiting_input` normalmente, sem exceção.
 */
export class VolundAwaitingInputError extends VolundError {
  readonly requestId: string;
  readonly kind: "vault" | "approval";

  constructor(requestId: string, kind: "vault" | "approval") {
    super(`Run pausou aguardando entrada do tipo "${kind}" (request ${requestId}).`, {
      code: "awaiting_input",
    });
    this.name = "VolundAwaitingInputError";
    this.requestId = requestId;
    this.kind = kind;
  }
}

/** Constrói a subclasse certa a partir de uma resposta de erro da API. */
export function errorFromApiResponse(
  status: number,
  body: { error?: string; message?: string }
): VolundError {
  const code = (body.error ?? "internal_error") as VolundErrorCode;
  const message = body.message ?? `Requisição falhou (HTTP ${status}).`;
  switch (code) {
    case "missing_api_key":
    case "invalid_api_key":
      return new VolundAuthError(message, code);
    case "forbidden":
      return new VolundForbiddenError(message);
    case "agent_not_found":
    case "run_not_found":
      return new VolundNotFoundError(message, code);
    case "run_busy":
      return new VolundRunBusyError(message);
    default:
      return new VolundError(message, { code, status });
  }
}
