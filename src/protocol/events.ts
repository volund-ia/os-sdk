/**
 * ⚠️  ARQUIVO VENDORADO — NÃO EDITE À MÃO ABAIXO DO SENTINEL.
 *
 * Cópia fiel de `lib/agent/connectors/api/events.ts` do repo `volund-os`
 * (a FONTE ÚNICA do contrato VolundEvent v1). O servidor emite estes eventos;
 * este pacote os entrega tipados. Manter os dois em sincronia é invariante do
 * projeto — o CI roda `scripts/check-protocol-drift.mjs`, que falha se o
 * conteúdo abaixo do sentinel divergir do upstream.
 *
 * Para atualizar: rode `npm run sync:protocol` (copia do volund-os) — nunca
 * edite o corpo manualmente. Promover para um pacote `@volund/protocol`
 * publicado no futuro é trivial: este diretório não importa nada do SDK.
 */
/* ---- BEGIN VENDORED CONTRACT (gerado; não edite abaixo) ---- */
/**
 * Contrato público de eventos do Volund OS SDK — VERSÃO 1.
 *
 * Fonte única (graduada de `docs/prototypes/sse-adapter/events.ts`). É o que o
 * servidor (Parte A) emite via SSE e o que o SDK (Parte B) entregará como
 * AsyncIterable<VolundEvent>. Clientes externos dependem disso por anos —
 * NÃO altere os tipos públicos sem bump de SCHEMA_VERSION.
 *
 * DECISÕES DESTA VERSÃO (aprovadas pelo time em 22/06):
 *  [D1] Naming = snake_case no wire. Consistente com a API pública que JÁ
 *       existe (GET /api/v1/runs/{id} e webhook) E com o padrão do ecossistema:
 *       Anthropic é 100% snake_case no fio; Cursor espelha em snake_case os
 *       campos estilo Claude Code. camelCase fica reservado p/ ergonomia futura
 *       na borda da linguagem (mapeado no SDK), não no contrato.
 *  [D2] Status reusa o vocabulário do GET /runs: "completed" | "failed".
 *       Pausa (HITL) = UM evento genérico `awaiting_input { kind }`. `kind` é
 *       "vault" | "approval" (esta PR adiciona "approval"). Sobre `bypassPermissions`:
 *       ele desliga só as prompts NATIVAS do Claude; aprovações configuradas pelo
 *       owner seguem ativas via PreToolUse hook, então runs via API PODEM pausar por
 *       aprovação (ver AwaitingInputEvent). Adicionar valor a essa união é ADITIVO no
 *       wire → SEM bump de SCHEMA_VERSION.
 *  [D3] tool_result.is_error CONFIRMADO real no nível stream-json: vem como
 *       `is_error: true` dentro do tool_result (no evento cru `user`). O
 *       types.ts da Volund não o tipa → o adapter lê do cru via cast. Mantido
 *       opcional (só presente/true em erro de ferramenta).
 *  [D4] Versionamento (modelo combinado): campo `protocol` no run_started
 *       (portátil p/ HTTP e CLI) p/ MAJOR; minor/patch via política
 *       "ignore unknown fields" (clientes ignoram campos desconhecidos).
 *  [D5] SSE `id:` por evento é emitido pelo ADAPTER (não é campo de payload),
 *       RESERVADO p/ reconexão futura (V2). A V1 NÃO promete retomada.
 *
 * ROTEAMENTO DE ERROS (por `type`, nunca por posição):
 *  - erro de ferramenta  → tool_result.is_error (este arquivo, ToolResultEvent)
 *  - falha do run inteiro → run_finished status:"failed" + error
 *  - erro de transporte   → cru `system/api_retry`: NÃO exposto na V1 (interno;
 *                           retries são tratados dentro da nuvem).
 *
 * REGRAS DE OURO:
 *  1. NÃO vazar interno: nada de session_id, sandbox, scratchDir, nome do
 *     executor (claude-code/cursor), api_retry, nem formatos do AI SDK.
 *  2. Versionar (SCHEMA_VERSION). Mudança incompatível => bump MAJOR.
 *  3. input/output são `unknown` mas DEVEM ser JSON-serializáveis.
 *  4. Fonte única: servidor importa daqui; o pacote @volund/sdk publica daqui.
 *
 * INVARIANTES DO ADAPTER (blindagem contra inconsistências):
 *  I1. tool_call.input é emitido COMPLETO. O input chega vazio no 1º snapshot e
 *      completo depois. O adapter acumula input_json_delta e só emite no
 *      content_block_stop — nunca um input meio-vazio.
 *  I2. tool_result.output é NORMALIZADO: bloco MCP [{type:"text",text}] vira
 *      string; imagem `data:image/...` vira placeholder (não trafega binário);
 *      tamanho limitado. Saída sempre JSON-serializável e enxuta.
 *  I3. Sentinel de vault (__vault_request_pending__:<id>) NUNCA vaza como
 *      tool_result — o adapter detecta e emite awaiting_input{kind:"vault"},
 *      suprimindo o sentinel e o run_finished subsequente.
 *  I4. Texto duplicado: o adapter faz diff entre partials e snapshot cumulativo
 *      (gate hasSeenPartials), nunca reemite texto já enviado.
 *  I5. Stream drenado por inteiro (dispara persister + hooks via o tap em
 *      runAgentV2); abort do cliente → kill(). RESSALVA HITL: no vault o run
 *      termina sozinho (emite `result`); o adapter NÃO dá kill — só suprime a
 *      saída ao cliente e continua drenando até o `result` natural, pra o
 *      persister flipar a thread pra `awaiting_vault` e `handle.finished`
 *      resolver. Ver sse-adapter.ts.
 *  I6. V1 achata turnos: um único stream ordenado de deltas, sem id de bloco/
 *      turno no payload.
 */

/** Versão do schema. Bump em qualquer mudança incompatível. */
export const SCHEMA_VERSION = "v1" as const;

// ---------------------------------------------------------------------------
// Eventos públicos — wire SSE: cada um é uma linha `data: <json>\n\n`
// ---------------------------------------------------------------------------

/**
 * Primeiro evento do stream. run_id === thread_id (detalhe opaco p/ o cliente).
 * Carrega `protocol` p/ o cliente validar a versão do contrato logo no começo
 * (modelo Anthropic system/init), sem depender de inspecionar headers. [D4]
 */
export interface RunStartedEvent {
  type: "run_started";
  protocol: typeof SCHEMA_VERSION;
  run_id: string;
  agent_id: string;
}

/** Raciocínio do agente, em streaming (origem: partials stream_event). */
export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  delta: string;
}

/** Resposta do agente, em streaming token a token (origem: partials stream_event). */
export interface AssistantTextDeltaEvent {
  type: "assistant_text_delta";
  delta: string;
}

/** O agente chamou uma ferramenta (origem: assistant → content[].tool_use). */
export interface ToolCallEvent {
  type: "tool_call";
  tool_call_id: string;
  tool_name: string;
  /** JSON-serializável e COMPLETO (invariante I1). */
  input: unknown;
}

/** Uma ferramenta retornou (origem: user → content[].tool_result). */
export interface ToolResultEvent {
  type: "tool_result";
  tool_call_id: string;
  /** JSON-serializável e NORMALIZADO (invariante I2): texto desembrulhado,
   *  imagem vira placeholder, tamanho limitado. */
  output: unknown;
  /** [D3] Presente (true) quando a ferramenta falhou. Vem do `is_error` dentro
   *  do tool_result cru (evento `user`), que o types.ts da Volund não tipa. */
  is_error?: boolean;
}

/**
 * HITL: o run pausou esperando ação humana. [D2] Modelo genérico: `kind` é união
 * extensível. O servidor emite este evento, SUPRIME o resto do stream e o cliente
 * retoma pelos endpoints existentes.
 *
 * Casos suportados:
 *  - "vault"    — preencher uma credencial no cofre.
 *  - "approval" — decidir uma aprovação de ferramenta (sentinel
 *                 `__approval_pending__`, status `awaiting_approval`). Embora runs
 *                 via API usem `--permission-mode bypassPermissions` (desliga as
 *                 prompts NATIVAS do Claude), aprovações configuradas pelo owner
 *                 continuam ativas via PreToolUse hook — então podem pausar.
 *
 * Adicionar um valor de `kind` é ADITIVO no WIRE (clientes v1 ainda parseiam o evento;
 * ignoram o que não conhecem) → NÃO exige bump de SCHEMA_VERSION. Obs.: para
 * consumidores TypeScript, a união mais larga pode quebrar *exhaustive checks* em
 * compile-time — isso se sinaliza pelo SEMVER do pacote SDK (bump minor + nota de
 * migração), NÃO por SCHEMA_VERSION (que é o protocolo do wire).
 */
export interface AwaitingInputEvent {
  type: "awaiting_input";
  request_id: string;
  kind: "vault" | "approval";
}

/** Último evento de um stream que termina normalmente (origem: result). */
export interface RunFinishedEvent {
  type: "run_finished";
  /** [D2] Mesmo vocabulário do GET /runs e do webhook. */
  status: "completed" | "failed";
  /** Texto final (origem: result.result). Pode ser null. */
  output: string | null;
  /** Origem: result.usage (snake_case já usado na API). Pode ser null. */
  usage: { input_tokens?: number; output_tokens?: number } | null;
  /** Preenchido quando status === "failed". */
  error?: string;
}

/** União discriminada pública. Faça narrowing por `event.type`. */
export type VolundEvent =
  | RunStartedEvent
  | ThinkingDeltaEvent
  | AssistantTextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | AwaitingInputEvent
  | RunFinishedEvent;

/** Todos os literais de `type` (útil p/ exhaustiveness/validação). */
export type VolundEventType = VolundEvent["type"];

// ---------------------------------------------------------------------------
// Entradas do SDK (request) — args dos métodos run()/continue().
// ---------------------------------------------------------------------------

/** Mesmo shape do { url } | { data } que a API atual aceita. */
export type VolundFileInput =
  | { url: string; name?: string }
  | { data: string; name?: string; mime?: string };

/**
 * Gancho p/ V2 (inferência na nuvem + execução local). Na V1 só "cloud"
 * existe; o tipo já antecipa a V2 sem fechar a porta. NÃO implementar "local".
 */
export type ExecutionMode = "cloud" | { local: { cwd: string } };

export interface RunInput {
  agentId: string;
  input: string;
  files?: VolundFileInput[];
  execution?: ExecutionMode;
}

export interface ContinueInput {
  runId: string;
  input: string;
  files?: VolundFileInput[];
  execution?: ExecutionMode;
}

// ---------------------------------------------------------------------------
// Códigos de erro — espelham os que a API já devolve em { error, message }.
// ---------------------------------------------------------------------------

export type VolundErrorCode =
  | "missing_api_key" // 401
  | "invalid_api_key" // 401
  | "forbidden" // 403
  | "agent_not_found" // 404
  | "run_not_found" // 404
  | "run_busy" // 409 — já há um run ativo na thread (só na continuação)
  | "internal_error"; // 5xx
