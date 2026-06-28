# Tasks: sdk-long-run-resilience-and-hitl

> ⚠️ **NÃO implementar ainda.** Esta é a lista planejada (todos os itens abertos).
> Ordem segue o `design.md`. Itens marcados **[backend]** dependem do `volund-os`.

## 0. Pré-trabalho (descoberta)
- [ ] 0.1 Mapear os endpoints reais de **vault** no `volund-os` (rota, corpo, auth,
        resposta). Sem isso, o Item 1 não começa.
- [ ] 0.2 **[infra]** Confirmar o teto efetivo de `maxDuration` no plano Vercel em uso.

## 1. Resiliência a runs longos (Item 3 — começar por aqui, é barato)
- [ ] 1.1 Documentar no README: `timeoutMs` é **pré-stream**, não duração do run;
        runs longos dependem do limite do servidor.
- [ ] 1.2 Registrar o limite confirmado em 0.2 na doc.
- [x] 1.3 *Idle timeout* opt-in → **promovido para a change `add-sdk-idle-timeout`** (implementado por TDD).

## 2. HITL — retomar vault (Item 1 — maior valor de DX)
- [ ] 2.1 Definir a superfície: `volund.runs.submitVault(runId, requestId, payload)`
        (nomes/forma a confirmar com 0.1).
- [ ] 2.2 Implementar o wrapper HTTP sobre o endpoint existente + erros tipados.
- [ ] 2.3 Documentar o fluxo: `awaiting_input` → `submitVault` → `continue` p/ retomar.
- [ ] 2.4 Testes: unit com `fetch` injetado (sucesso + erro); exemplo de dogfooding.

## 3. HITL — aprovação (Item 2 — [backend] primeiro)
- [ ] 3.1 **[backend]** API pública passar a suportar pausa por aprovação.
- [ ] 3.2 Adicionar `kind:"approval"` ao `awaiting_input` no `events.ts` do servidor;
        re-vendorar no SDK via `npm run sync:protocol`; **bump `SCHEMA_VERSION`**.
- [ ] 3.3 SDK: helper `volund.runs.approve(runId, approvalId, decision)` + testes.

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
