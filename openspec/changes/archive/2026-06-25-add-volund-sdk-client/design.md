# Design: add-volund-sdk-client

## Contexto

A Parte A (servidor) está pronta e graduada em produção. Ela expõe:

- `POST /api/v1/agents/{agentId}/stream` — dispara run novo, body `{ input, files? }`.
- `POST /api/v1/runs/{runId}/stream` — continua thread, body `{ input, files? }`.
- Auth: `Authorization: Bearer vos_live_...`.
- Sucesso: `200 text/event-stream`, frames `id: <n>\n` + `data: <VolundEvent json>\n\n`,
  heartbeat `: ping\n\n` a cada ~15s.
- Erro pré-stream: status normal (401/403/404/409/400/5xx) + JSON `{ error, message }`.

Este pacote é um **cliente HTTP fino** sobre isso. Todo o trabalho difícil de
diff/dedup de eventos já foi resolvido no `sse-adapter.ts` do servidor — o SDK
só precisa transportar e tipar.

## Decisões

### D1 — Contrato vendorado + drift-guard (não pacote publicado, ainda)

`src/protocol/events.ts` é cópia byte-a-byte de
`volund-os/lib/agent/connectors/api/events.ts`, abaixo de um sentinel. Scripts:
`sync:protocol` (re-copia) e `check:protocol` (CI falha em divergência).

- **Por quê:** zero overhead de pipeline de publicação agora; o guard dá a
  garantia prática de "fonte única". O diretório `protocol/` não importa nada do
  SDK → promover a um `@volund/protocol` publicado depois é trivial.
- **Alternativas:** pacote publicado (coordenação/CI entre 2 repos agora); cópia
  manual (drift silencioso — rejeitado).

### D2 — Parser SSE sobre `eventsource-parser`

Usar `EventSourceParserStream` (mesmo parser do Vercel AI SDK / OpenAI SDK)
componível com `TextDecoderStream`.

- **Por quê:** resolve de graça as 3 armadilhas do wire (heartbeat-comentário,
  `id:`, `data:` multi-linha/partido). É a parte mais bugada de fazer à mão
  (proposta §4.6). `eventsource-parser` é zero-dependency e web-standard.
- **Trade-off:** uma dep de runtime, contra o ideal "zero deps" da proposta §4.5.
  Decisão: correção e manutenção > dogma. Marcada como `external` no bundle.

### D3 — Distinguir stream de erro ANTES de parsear (`http.ts`)

Erros pré-stream NÃO são SSE. `postStream` checa `res.ok` + `content-type:
text/event-stream`; só então devolve a `Response` para virar `Run`. Caso
contrário lê `{ error, message }` e lança a subclasse de `VolundError` certa.

### D4 — `result()` lança em vez de retornar nulo

`run.result()` lança `VolundRunFailedError` em `run_finished status:"failed"` e
`VolundAwaitingInputError` em `awaiting_input`. Devolve `{ output, usage }` no
caminho feliz. Quem precisa observar falha/pausa sem exceção usa `stream()`.

### D5 — `stream()` consumível uma única vez

É um stream de rede. Segunda chamada (ou `stream()` + `result()`) lança
`stream_error`. Documentado no README (proposta §4.3). Tee/buffer fica p/ V2.

### D6 — `signal`/cancelamento fora do contrato do wire

`RunOptions = RunInput & { signal? }`. Internamente cada run tem um
`AbortController`; `run.cancel()` o aborta → fecha a conexão → o servidor mata a
sandbox (o `sse-adapter` liga `req.signal` ao `handle.kill()`). O `signal` do
usuário é encadeado ao interno.

### D7 — Gancho `execution` (V2) presente, mas só `"cloud"` na V1

O tipo `ExecutionMode = "cloud" | { local: { cwd } }` já existe no contrato.
`agents.run/continue` aceitam, mas lançam `unsupported` se vier `local`. Não
fechar a porta da V2 (execução local estilo Cursor) é requisito da proposta §7.

### D8 — Build com `tsdown`

ESM-first, gera ESM+CJS+`.d.ts`, ~2× mais rápido que tsup (8× em declarações),
migração trivial caso se queira voltar. `exports` com `types` por condição.

## Arquitetura de arquivos

```
src/
  protocol/events.ts  → contrato VENDORADO (fonte única; sem imports do SDK)
  index.ts            → superfície pública
  client.ts           → VolundOS (config, validação, baseUrl)
  http.ts             → fetch + headers + erro pré-stream (D3)
  agents.ts           → run()/continue(), AbortController, gancho execution (D6/D7)
  run.ts              → Run.stream()/result()/cancel() (D4/D5)
  sse.ts              → parseVolundSSE (D2)
  errors.ts           → VolundError + subclasses
```

Fluxo: `agents.run()` → `http.postStream()` → `new Run(response)` →
`run.stream()` → `parseVolundSSE(response.body)` → `AsyncIterable<VolundEvent>`.

## Testes

- **Unit (offline, vitest):** parser SSE com fixtures — sequência completa,
  heartbeat, frame partido entre chunks, byte-a-byte, tipo desconhecido/JSON
  malformado, `awaiting_input`. (Reaproveitar fixtures do `sse-adapter.test.ts`.)
- **Erros:** `errorFromApiResponse` mapeia cada código → subclasse certa.
- **Integração (manual/staging):** `examples/quickstart.ts` contra agente real.
- **Tipos:** `tsc --noEmit` no consumidor garante que os `.d.ts` resolvem.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Drift do contrato | `check:protocol` no CI (D1) |
| Frame SSE partido | `eventsource-parser` + teste dedicado (D2) |
| Parsear corpo de erro como stream | checagem de content-type (D3) |
| Duplo consumo do stream | erro explícito + doc (D5) |
| Sandbox pendurada em abort | `cancel()` → abort → `handle.kill()` no servidor (D6) |
