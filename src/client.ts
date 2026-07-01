/**
 * `VolundOS` — ponto de entrada do SDK. Configuração mínima: uma API key.
 *
 *   const volund = new VolundOS({ apiKey: process.env.VOLUND_API_KEY! });
 *   const run = await volund.agents.run({ agentId, input });
 */

import { Agents } from "./agents";
import { Approvals } from "./approvals";
import { VolundError } from "./errors";
import type { HttpConfig } from "./http";

/** Endpoint de produção do Volund OS (decisão de proposta §6). */
const DEFAULT_BASE_URL = "https://os.volund.com.br";

export interface VolundOSConfig {
  /** Chave de API "vos_live_...". Obrigatória. */
  apiKey: string;
  /** Sobrescreve a URL base (staging/local). Default: produção. */
  baseUrl?: string;
  /** Injeta um `fetch` (testes ou runtimes sem fetch global). */
  fetch?: typeof fetch;
  /**
   * Headers extra em toda requisição. Útil p/ o Protection Bypass da Vercel ao
   * testar contra um preview deployment:
   * `{ "x-vercel-protection-bypass": process.env.VERCEL_BYPASS! }`.
   * Os headers obrigatórios (Authorization/Content-Type/Accept) não podem ser
   * sobrescritos.
   */
  defaultHeaders?: Record<string, string>;
  /**
   * Timeout (ms) p/ RECEBER a resposta (headers). NÃO limita a duração do stream
   * — um run pode durar minutos. Default: 60000. Use 0 para desligar.
   */
  timeoutMs?: number;
  /**
   * Tentativas extras em erro de rede/5xx (só na fase pré-stream). **Default: 0
   * (sem retry).** ⚠️ `run`/`continue` não são idempotentes — um 5xx ou queda de
   * conexão pode ter criado o run mesmo assim, então retentar pode DUPLICAR runs.
   * Só aumente se a duplicidade for aceitável no seu caso de uso.
   */
  maxRetries?: number;
  /**
   * Idle timeout (ms) da fase de STREAMING: aborta o run se nenhum byte (evento
   * ou heartbeat) chegar nesse intervalo. NÃO confunda com `timeoutMs` (pré-stream)
   * nem com a duração total do run (que pode ser longa). Default: desligado.
   */
  idleTimeoutMs?: number;
}

export class VolundOS {
  /** Disparo e continuação de runs de agente. */
  readonly agents: Agents;
  /** Decisão de aprovações HITL (approve/reject) — ver `awaiting_input{kind:"approval"}`. */
  readonly approvals: Approvals;

  constructor(config: VolundOSConfig) {
    if (!config?.apiKey || typeof config.apiKey !== "string") {
      throw new VolundError("apiKey é obrigatória.", { code: "missing_api_key" });
    }

    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new VolundError(
        "fetch global indisponível. Use Node ≥18 ou injete `fetch` no config.",
        { code: "unsupported" }
      );
    }

    const http: HttpConfig = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      // Liga o `fetch` ao globalThis p/ não perder o `this` em algumas impls.
      fetch: (...args) => fetchImpl(...args),
      ...(config.defaultHeaders ? { defaultHeaders: config.defaultHeaders } : {}),
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
      ...(config.idleTimeoutMs !== undefined ? { idleTimeoutMs: config.idleTimeoutMs } : {}),
    };

    this.agents = new Agents(http);
    this.approvals = new Approvals(http);
  }
}
