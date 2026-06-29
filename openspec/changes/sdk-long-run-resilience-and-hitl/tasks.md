# Tasks: sdk-long-run-resilience-and-hitl

> ⚠️ **NÃO implementar ainda.** Esta é a lista planejada (todos os itens abertos).
> Ordem segue o `design.md`. Itens marcados **[backend]** dependem do `volund-os`.

## 0. Pré-trabalho (descoberta)
- [x] 0.1 Mapeado (26/06): **NÃO há endpoint de vault por API key** — só sessão web
        (`/api/vault-requests/[id]`, `getUser`) ou token de run interno
        (`/api/v2/mcp/vault-fill`). Vault resume vira **[backend]** (ver design).
- [~] 0.2 **[infra]** maxDuration. **Revisado (27/06):** todas as rotas v1 declaram
        `export const maxDuration = 800` (run, stream, continue, approvals/decide) e o
        `vercel.json` **NÃO** tem cap de `functions`. → o teto efetivo depende do
        **plano Vercel / Fluid Compute**, não do código (`800` só vale se o plano
        permitir; senão a plataforma corta). **Falta:** confirmar no **painel da Vercel**
        se o plano honra 800s. Sem PR — é checagem de ops.

## 1. Resiliência a runs longos (Item 3 — começar por aqui, é barato)
- [ ] 1.1 Documentar no README: `timeoutMs` é **pré-stream**, não duração do run;
        runs longos dependem do limite do servidor.
- [ ] 1.2 Registrar o limite confirmado em 0.2 na doc.
- [ ] 1.3 (Opcional) Avaliar um *idle timeout* opt-in (abortar após N s sem evento).

## 2. HITL — retomar vault (Item 1) — 🔒 BLOQUEADO (backend-first)
> 0.1 confirmou: não há endpoint por API key. Precede o SDK.
- [ ] 2.0 **[backend]** Criar `POST /api/v1/runs/{runId}/vault/{requestId}` (auth API
        key, reusa `fulfillVaultRequest`).
- [ ] 2.1 Definir a superfície: `volund.runs.submitVault(runId, requestId, payload)`
        (depende de 2.0).
- [ ] 2.2 Implementar o wrapper HTTP sobre o endpoint existente + erros tipados.
- [ ] 2.3 Documentar o fluxo: `awaiting_input` → `submitVault` → `continue` p/ retomar.
- [ ] 2.4 Testes: unit com `fetch` injetado (sucesso + erro); exemplo de dogfooding.

## 3. HITL — aprovação (Item 2 — [backend] primeiro; mecanismo JÁ existe)
> Investigação 26/06: sentinel `__approval_pending__`, status `awaiting_approval` e
> `resumeAgentAfterDecision` já existem (fluxo web). Falta surfar na API + decide por API key.
- [x] 3.1 **[backend]** `sse-adapter.ts` detecta `__approval_pending__` e emite
        `awaiting_input{kind:"approval"}` — **volund-os#174** (aberto; TDD 15/15).
- [x] 3.2a **[backend]** `events.ts`: `kind` → `"vault" | "approval"` — **volund-os#174**
        (ADITIVO; **sem** bump de `SCHEMA_VERSION` — clientes antigos ignoram kind novo).
- [ ] 3.2b Re-vendorar o contrato no SDK via `npm run sync:protocol` (após #174 mergear).
- [ ] 3.3 **[backend]** `POST /api/v1/approvals/{id}/decide` (auth API key, reusa
        `resumeAgentAfterDecision`).
- [ ] 3.4 **[backend]** Verificar que o approval gate dispara p/ `source:"api"`.
- [ ] 3.5 SDK: helper `volund.runs.approve(runId, requestId, decision)` + tratar
        `kind:"approval"` + testes (TDD).

## 4. Reconexão de stream (Item 4 — V2, [backend] + SDK)
- [ ] 4.1 **[backend]** Implementar replay por `Last-Event-ID` na rota `/stream`.
- [ ] 4.2 SDK: reconexão opt-in (`run.stream({ resume: true })`) guardando o último id.
- [ ] 4.3 Testes de reconexão (simular queda no meio do stream).

## 5. Fechamento
- [ ] 5.1 `openspec validate sdk-long-run-resilience-and-hitl` a cada iteração.
- [ ] 5.2 Implementar incrementalmente (1 → 2 → 3 → 4); arquivar quando concluído.

## Já satisfeito (NÃO refazer — só registro)
- [x] Abort → `handle.kill()` (servidor + `run.cancel()`/teardown do SDK)
- [x] Drain obrigatório (servidor)
- [x] Heartbeat `: ping` (servidor envia; SDK ignora)
- [x] `409 run_busy` (SDK mapeia; backend emite — volund-os #163)
- [x] HITL vault: **emitir** `awaiting_input` + fechar stream (falta só o *retomar*, Item 2 acima)
