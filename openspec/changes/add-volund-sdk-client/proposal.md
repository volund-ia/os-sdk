# Change: add-volund-sdk-client

> Parte B do projeto `@volund/sdk`. Consome o endpoint de streaming criado na
> Parte A (`volund-os`, rotas `POST /api/v1/agents/{id}/stream` e
> `/runs/{id}/stream`, contrato `VolundEvent` v1).

## Why

A Parte A já entrega `VolundEvent` via SSE, mas hoje só dá pra consumir com
`fetch` + parsing manual de `text/event-stream` — e o wire tem armadilhas
(heartbeat `: ping`, linhas `id:`, frames partidos entre chunks). Falta o
pacote NPM que qualquer dev instala e usa em poucas linhas, com tipos e DX
espelhando o Cursor SDK, escondendo o transporte.

## What Changes

- **Novo pacote `@volund/sdk`** — cliente HTTP fino: `new VolundOS()` →
  `agents.run()/continue()` → `Run` com `.stream()` (AsyncIterable<VolundEvent>),
  `.result()` (texto final) e `.cancel()`.
- **Parser SSE robusto** sobre `eventsource-parser` — ignora heartbeat, lida com
  `id:` e frames partidos; ignora tipos desconhecidos (forward-compat).
- **Mapeamento de erros** — respostas de erro pré-stream (`{ error, message }`)
  viram subclasses tipadas de `VolundError` (`VolundAuthError`,
  `VolundForbiddenError`, `VolundNotFoundError`, `VolundRunBusyError`, ...).
- **Contrato vendorado** — `src/protocol/events.ts` é cópia fiel do `volund-os`,
  com drift-guard em CI (`scripts/check-protocol-drift.mjs`).
- **Empacotamento** — `tsdown` gera ESM + CJS + `.d.ts`; zero deps além de
  `eventsource-parser`; publicação `@volund/sdk@0.1.0` (beta).

## Impact

- **Affected specs:** `volund-sdk-client` (nova capability, neste repo).
- **Affected code:** novo repo `volund-sdk` inteiro (`src/`, `tests/`, `scripts/`,
  CI). Nenhuma mudança no `volund-os` — só consumo do contrato existente.
- **Dependência externa:** a Parte A precisa estar deployada na `baseUrl`
  configurada para o dogfooding ponta-a-ponta.
- **Riscos:** drift do contrato (mitigado pelo guard); `stream()` consumível uma
  vez (documentado + erro explícito); diferença de runtime de `fetch`/streams.

## Decisões registradas

Herdadas da Parte A / proposta-base §6 (já fechadas): transporte **SSE**, rotas
`/stream` separadas, `baseUrl` default `https://os.volund.com.br`, contrato
**snake_case** no wire, reconexão automática só na V2.

Tomadas nesta change (ver `design.md`):
- **Vendorar o contrato + drift-guard** (em vez de pacote publicado agora).
- **`eventsource-parser`** em vez de hand-roll (correção > dogma zero-dep).
- **`tsdown`** como bundler (sucessor do tsup; ESM-first, declarações rápidas).
- **`result()` lança** em run `failed`/`awaiting_input` (em vez de retorno nulo).
- **`signal` fica fora do contrato do wire** — é ergonomia de runtime do SDK.
