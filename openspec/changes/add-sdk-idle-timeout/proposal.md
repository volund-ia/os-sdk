# Change: add-sdk-idle-timeout

> Change **focada** promovida do backlog `sdk-long-run-resilience-and-hitl`
> (Item 3 — resiliência a runs longos). Implementa a parte só-SDK: o
> `idleTimeoutMs`. Inclui spec + implementação + testes (item pequeno).

## Why

O SDK tinha só o `timeoutMs` (fase **pré-stream**). Faltava uma forma de detectar
um stream **travado** durante o run (conexão pendurada sem mais nada chegando) sem
matar runs longos saudáveis. O `maxDuration`/duração total é responsabilidade do
servidor; aqui resolvemos a **ociosidade** observável pelo cliente.

## What Changes

- **`VolundOSConfig.idleTimeoutMs`** (opt-in, default desligado): aborta o stream se
  NENHUM byte (evento **ou** heartbeat `: ping`) chegar no intervalo. Heartbeats
  resetam (são bytes), então runs quietos mas vivos não morrem.
- **Doc no README** separando os três conceitos: `timeoutMs` (pré-stream),
  `idleTimeoutMs` (ocioso) e duração total (servidor).
- Implementado por TDD (testes antes do código, em `tests/idle-timeout.test.ts`).

## Impact

- **Affected specs:** `volund-sdk-client` (novo requisito, ver `specs/`).
- **Affected code:** `sse.ts` (guarda de ociosidade no read loop), `run.ts`/
  `agents.ts`/`client.ts`/`http.ts` (plumbing da config). Aditivo — sem breaking.
- **Sem dependência de backend.** Não inventa endpoints.

## Origem
Promovido de `sdk-long-run-resilience-and-hitl` (Item 3). Os demais itens do backlog
(vault resume, approval, reconexão) seguem lá, deferidos.
