/**
 * `VolundOS` — ponto de entrada do SDK. Configuração mínima: uma API key.
 *
 *   const volund = new VolundOS({ apiKey: process.env.VOLUND_API_KEY! });
 *   const run = await volund.agents.run({ agentId, input });
 */

import { Agents } from "./agents";
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
   * Tentativas extras em erro de rede/5xx (só na fase pré-stream). Default: 2.
   * Use 0 para desligar. ⚠️ `run`/`continue` não são idempotentes — um 5xx pode
   * ter criado o run mesmo assim; baixe para 0 se a duplicidade for inaceitável.
   */
  maxRetries?: number;
}

export class VolundOS {
  /** Disparo e continuação de runs de agente. */
  readonly agents: Agents;

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
    };

    this.agents = new Agents(http);
  }
}
