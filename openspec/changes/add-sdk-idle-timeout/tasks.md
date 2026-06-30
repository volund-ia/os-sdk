# Tasks: add-sdk-idle-timeout

> TDD: testes escritos ANTES do código; testes não foram alterados para o código
> passar. Suíte: 58/58 verdes; typecheck/build/drift OK.

## 1. Testes (primeiro)
- [x] 1.1 `tests/idle-timeout.test.ts`: ocioso estoura; heartbeat reseta; sem opção
        nunca estoura; ponta-a-ponta (consumidor recebe timeout + conexão abortada).
- [x] 1.2 Rodar e confirmar que **falham** sem a implementação (red).

## 2. Implementação
- [x] 2.1 `sse.ts`: `ParseOptions.idleTimeoutMs` + `readChunk` (race read × idle;
        cancel + reject no timeout).
- [x] 2.2 `run.ts`: `Run` aceita `idleTimeoutMs` e repassa a `parseVolundSSE`.
- [x] 2.3 `agents.ts`/`http.ts`/`client.ts`: plumbing da config (opt-in, default off).
- [x] 2.4 README: seção "Timeouts e runs longos" (pré-stream × idle × duração).

## 3. Verificação
- [x] 3.1 Testes passam (green) sem alterar os testes.
- [x] 3.2 `npm test` (58/58), `typecheck`, `build`, `check:protocol` OK.

## 4. Fechamento
- [ ] 4.1 `openspec archive add-sdk-idle-timeout` após o merge.
