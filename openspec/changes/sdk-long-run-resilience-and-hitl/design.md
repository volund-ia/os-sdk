# Design / Plano — sdk-long-run-resilience-and-hitl

> Plano de como abordar cada item deferido **da melhor forma**, sem fechar portas.
> Não implementar ainda — este documento é a referência para quando for priorizado.

## Princípios que guiam o plano

1. **Não quebrar a V1.** Tudo aqui é **aditivo** (novos métodos/eventos), nunca
   mudança incompatível na superfície atual (`agents.run/continue`, `run.stream/
   result/cancel`).
2. **Não vazar interno.** Manter o contrato público agnóstico de sandbox/executor
   (regra de ouro do `events.ts`).
3. **Separar o que é SDK do que é backend.** Vários itens dependem do `volund-os`;
   marcar a fronteira explicitamente.
4. **Versionar com cuidado** — `SCHEMA_VERSION` é o **protocolo do wire**
   (`protocol:"v1"`), **não** o semver do pacote. Mudança **aditiva** (novo valor de
   `kind`, novo evento) é compatível no wire → **NÃO** bumpar `SCHEMA_VERSION` (e
   clientes ignoram o que não conhecem em runtime). A mudança de **tipo TS** que isso
   causa (união mais larga) sinaliza-se via **semver minor do pacote** + **nota de
   migração**. Só mudança **incompatível** de shape (alterar/remover campo) exige bump
   de `SCHEMA_VERSION` (MAJOR).

---

## Item 1 — HITL: retomar após pausa de vault (`awaiting_input`)

**Hoje:** o SDK emite `awaiting_input{kind:"vault", request_id}` e o stream fecha. O
cliente fica sem caminho ergonômico para *continuar* — teria que chamar o endpoint
de vault na mão.

**Plano (melhor forma):**
- Adicionar um namespace `volund.runs` (ou `volund.vault`) com helpers tipados que
  encapsulam os **endpoints já existentes** do `volund-os` para preencher o cofre.
  Esboço de DX (sujeito a confirmação dos endpoints reais):
  ```ts
  for await (const ev of run.stream()) {
    if (ev.type === "awaiting_input" && ev.kind === "vault") {
      await volund.runs.submitVault(run.id, ev.request_id, { secret: "..." });
      const resumed = await volund.agents.continue({ runId: run.id, input: "" });
      // segue observando o resumed.stream()
    }
  }
  ```
- **Decisão de escopo:** na primeira iteração, **só os helpers de submeter** + um
  `continue` para reabrir o stream. Retomar o **mesmo** stream sem reabrir é o Item 4.
- **INVESTIGADO (26/06):** NÃO existe endpoint de vault autenticado por **API key**.
  As rotas atuais usam **sessão web** (`supabase.auth.getUser()` em
  `/api/vault-requests/[id]` e `/api/agents/[agentId]/vault/*`) ou **token de run
  interno** (`/api/v2/mcp/vault-fill` via `authenticateRunToken`). O resume
  (`lib/vault/resume.ts` → `fulfillVaultRequest`) é construído em torno do conector web.
- **Conclusão:** vault resume é **backend-first** (igual ao approval) — um `vos_live_`
  não consegue preencher hoje. NÃO implementar no SDK até existir rota por API key.

**Fronteira (revisada):** **backend primeiro** — criar
`POST /api/v1/runs/{runId}/vault/{requestId}` (auth por API key, reusando
`fulfillVaultRequest`); só então o wrapper no SDK. **Cross-repo.**

---

## Item 2 — HITL: aprovação (`awaiting_approval`)

**STATUS (27/06):** passos 1+2 implementados em **volund-os#174** (aberto p/ review,
TDD 15/15). Falta o passo 3 (decide por API key) e o passo 5 (helper no SDK).

**INVESTIGADO (26/06) — o mecanismo JÁ existe internamente:**
- `lib/agent/core/tools/approval.ts`: o `withApprovalGate` persiste o pedido, flipa a
  thread para `execution_status:"awaiting_approval"` (+ `awaiting_approval_request_id`),
  e o tool_result carrega o **sentinel `__approval_pending__:<id>`** — exatamente
  análogo ao `__vault_request_pending__` do vault.
- Rotas existentes: `POST /api/approvals/[id]/decide` (`approve`/`reject`) e `/abort` —
  mas com **auth de sessão web** (`getUser`), não API key. `resumeAgentAfterDecision`
  (`lib/approvals/resume.ts`) faz o resume.
- `--permission-mode bypassPermissions` (run.ts) desliga só as prompts NATIVAS do
  Claude; aprovações configuradas pelo owner seguem ativas via PreToolUse hook — logo
  runs via API **podem** pausar por aprovação; só não são **surfadas** no stream da API.

**Plano (backend-first, mas pequeno — reusa tudo):**
1. **Emitir no stream da API:** no `sse-adapter.ts`, detectar `__approval_pending__`
   no tool_result (espelhar a lógica do sentinel de vault) e emitir
   `awaiting_input{kind:"approval", request_id}`, suprimindo o sentinel + parkeando.
2. **Contrato:** widen `AwaitingInputEvent.kind` para `"vault" | "approval"` no
   `events.ts` (servidor) — **aditivo no wire, SEM bump de `SCHEMA_VERSION`**;
   re-vendorar no SDK via `sync:protocol`. ⚠️ O widen **não** é aditivo em
   **compile-time TS** (quebra *exhaustive checks* e o próprio
   `VolundAwaitingInputError.kind`): sinalizar via **semver minor** do pacote (`0.3.0`)
   + **nota de migração**, e widenar os tipos do SDK no re-vendor.
3. **Endpoint por API key:** `POST /api/v1/approvals/{id}/decide` (auth
   `authenticateApiRequest`, body `{ decision, note? }`, reusa `resumeAgentAfterDecision`;
   checagem de permissão derivada da API key em vez de `getUser`).
4. **Verificar** que o PreToolUse approval gate dispara para `source:"api"`.
5. **SDK (depois):** `runs.approve(runId, requestId, decision)` + tratar `kind:"approval"`.

**Fronteira:** passos 1–4 no `volund-os`; passo 5 no `os-sdk`. **Cross-repo.**

---

## Item 3 — Resiliência a runs longos (`maxDuration` / plataforma)

**Hoje:** a rota `/stream` declara `maxDuration=800`. O timeout do **SDK** cobre só
a fase **pré-stream** (até a resposta/headers chegarem) — não limita a duração do
run. O streaming ajuda: a conexão fica "viva" com dados fluindo, o que evita timeouts
de proxy por silêncio (reforçado pelo heartbeat).

**Plano:**
- **Confirmar (ops):** o teto real de `maxDuration` no plano da Vercel usado (Hobby/
  Pro/Enterprise ou Fluid compute). Documentar o limite efetivo em produção.
- **Documentar no SDK:** deixar claro no README que `timeoutMs` é **pré-stream**, não
  duração do run; e que runs muito longos dependem do limite do servidor.
- **Opcional:** expor um *idle timeout* no SDK (abortar se ficar N segundos **sem
  nenhum evento**, inclusive sem heartbeat) — diferente do timeout pré-stream atual.
  Avaliar se vale a complexidade.

**Fronteira:** infra/ops (Vercel) + doc no SDK. Pouco/nenhum código novo.

---

## Item 4 — Reconexão de stream (retomar o mesmo run após queda)

**Hoje:** o contrato já **reserva** `id:` por evento (o servidor emite IDs
incrementais; a V1 não promete retomada). O "tratamento sofisticado" foi adiado pelo
próprio §3.5.

**Plano (V2):**
- Cliente guarda o `Last-Event-ID` recebido; ao cair, reabre com header
  `Last-Event-ID: <n>` e o servidor **reenvia a partir dali**.
- **Depende do backend** implementar o replay por `Last-Event-ID` (hoje os IDs são só
  reservados, não há replay).
- Expor no SDK como **opt-in** (ex.: `run.stream({ resume: true })`) para não mudar o
  comportamento default.

**Fronteira:** backend (replay) + SDK (reconexão). **Cross-repo, V2.**

---

## Ordem recomendada (quando priorizar)

1. **Item 3 (doc + confirmar Vercel)** — barato, sem dependência, tira ambiguidade.
2. **Item 1 (vault resume)** — maior valor de DX; só SDK, se os endpoints já existem.
3. **Item 2 (approval)** — quando o backend suportar approval-pause.
4. **Item 4 (reconexão)** — V2, maior esforço, cross-repo.

## Como NÃO fazer (armadilhas)

- ❌ Inventar endpoints de vault/approval — confirmar os reais no `volund-os`.
- ❌ Abortar a conexão ao receber `awaiting_input` achando que "acabou" — o servidor
  precisa terminar de persistir o estado parqueado (já tratado no SDK atual; manter).
- ❌ Mudar o shape de eventos de forma **incompatível** (alterar/remover campo) sem
  bump de `SCHEMA_VERSION` (MAJOR). *(Adicionar valor a uma união é aditivo no wire —
  ver Princípio 4: sinaliza-se por semver minor do pacote, não por `SCHEMA_VERSION`.)*
- ❌ Ligar reconexão por padrão antes do backend suportar replay por `Last-Event-ID`.
