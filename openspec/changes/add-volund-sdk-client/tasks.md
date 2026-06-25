# Tasks: add-volund-sdk-client

Ordem segue o §5 da proposta-base (passos 5–8) + scaffolding. Marque `[x]` ao
concluir. NÃO commitar até `typecheck` + `test` + `build` passarem.

## 1. Scaffold e fonte única do contrato
- [x] 1.1 Estrutura do repo (`src/`, `tests/`, `scripts/`, `examples/`, CI).
- [x] 1.2 Vendorar `src/protocol/events.ts` do `volund-os` (cópia + sentinel).
- [x] 1.3 `scripts/sync-protocol.mjs` + `scripts/check-protocol-drift.mjs`.
- [x] 1.4 `package.json` (tsdown, vitest, eventsource-parser), `tsconfig` strict,
        `tsdown.config.ts`, `vitest.config.ts`.
- [x] 1.5 `npm install` e confirmar que `npm run check:protocol` passa contra o
        `volund-os` irmão (✓ contrato em sincronia, byte-a-byte).

## 2. Parser SSE (a parte mais delicada — §5 passo 5)
- [x] 2.1 `src/sse.ts` — `parseVolundSSE` sobre `EventSourceParserStream`.
- [x] 2.2 Testes: sequência completa, heartbeat, frame partido, byte-a-byte,
        tipo desconhecido, JSON malformado, `awaiting_input`.
- [x] 2.3 (Opcional) importar fixtures gravadas do `sse-adapter.test.ts` do
        `volund-os` para teste de paridade ponta-a-ponta. (`tests/parity.test.ts`
        + `tests/fixtures/weather-run.events.json`; wire serializado como o
        transporte do servidor, 3 testes.)

## 3. Erros e transporte (§3 — armadilha de erro pré-stream)
- [x] 3.1 `src/errors.ts` — hierarquia `VolundError` + `errorFromApiResponse`.
- [x] 3.2 `src/http.ts` — `postStream` distingue stream de erro por content-type.
- [x] 3.3 Testes de `errorFromApiResponse` (401/403/404/409/5xx → subclasse).
        (`tests/errors.test.ts`, 10 testes.) + timeout/retry no `src/http.ts`
        (`timeoutMs`/`maxRetries` em `VolundOSConfig`; `tests/http.test.ts`, 9 testes).

## 4. Cliente (§5 passo 6)
- [x] 4.1 `src/run.ts` — `Run.stream()/result()/cancel()` (consumo único, abort).
- [x] 4.2 `src/agents.ts` — `run()/continue()`, AbortController, gancho execution.
- [x] 4.3 `src/client.ts` — `VolundOS` (validação de apiKey, baseUrl, fetch).
- [x] 4.4 `src/index.ts` — superfície pública (cliente + erros + tipos).
- [x] 4.5 Testes do cliente com `fetch` injetado devolvendo um SSE gravado
        (run novo, continue, result, erros 401/403/404/409, content-type errado,
        cancel via AbortController, consumo único, execution local). 17 testes.

## 5. Empacotamento e publicação (§5 passo 7)
- [x] 5.1 `npm run build` (tsdown) gera `dist/` ESM+CJS+`.d.ts` sem erro.
- [x] 5.2 `npm run typecheck` limpo.
- [x] 5.3 Smoke de consumo: importar de `dist` em projeto ESM e CJS (13 exports
        resolvem nos dois); `tsc --noEmit` limpo; `npm pack`/`npm link` OK; tarball
        instalado em projeto limpo com tipos ok sob `moduleResolution: nodenext`.
- [x] 5.4 CI verde (`.github/workflows/ci.yml`): check:protocol, typecheck, test, build.
        (✓ PR #2, job `build-test` verde.)
- [ ] 5.5 Publicar `@volund-ia/sdk@0.2.0` (beta) — `npm publish --access public`.

## 6. Dogfooding (§5 passo 8)
- [x] 6.1 Rodar contra agente real (`agt` UUID `6cb25420-…`, preview SSE da Vercel
        sobre o banco de produção). Validados ao vivo: `run` (quickstart), `continue`
        multi-turn com memória de thread (`examples/multiturn.ts`), `run.result()`
        (`examples/edge-result.ts`), `run.cancel()` → AbortError (`examples/edge-cancel.ts`).
- [ ] 6.2 Ajustar a DX com base na dor sentida; abrir issues p/ a V2 se houver.
  - [ ] 6.2.1 **[backend, não-SDK] `run_busy` não é emitido.** A API do volund-os NÃO
          sinaliza 409 quando se dispara `continue` numa thread com run ativo — ela
          aceita o run concorrente (ver `examples/edge-busy.ts`). O mapeamento
          409→`VolundRunBusyError` do SDK está correto e coberto por unit test; falta o
          servidor mandar o 409. Ação: abrir issue no volund-os para enforçar a trava
          de thread ocupada (ou documentar que runs são enfileirados).
  - [x] 6.2.2 **Doc do `VOLUND_AGENT_ID`.** O `.env.example`/`quickstart` sugeriam
          `agt_<uuid>`, mas a API espera o UUID PURO (com prefixo dá 404
          `agent_not_found`). Validado ao vivo no preview SSE. Corrigido em
          `.env.example` + `examples/quickstart.ts`.

## 7. Validação OpenSpec
- [ ] 7.1 `openspec validate add-volund-sdk-client`.
- [ ] 7.2 `openspec archive add-volund-sdk-client` quando tudo acima fechar.
