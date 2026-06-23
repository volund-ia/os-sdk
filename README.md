# @volund/sdk

Cliente TypeScript para rodar agentes do **Volund OS** pelo seu próprio código e
receber, em tempo real (streaming), tudo que o agente faz — raciocínio, chamadas
de ferramenta e a resposta token a token.

```bash
npm install @volund/sdk
```

> Requer Node ≥ 18 (usa o `fetch` nativo). Funciona também em Deno, Bun, Workers
> e no browser (parser SSE 100% web-standard).

## Quickstart

```ts
import { VolundOS } from "@volund/sdk";

const volund = new VolundOS({ apiKey: process.env.VOLUND_API_KEY! });

const run = await volund.agents.run({
  agentId: "agt_123",
  input: "Pesquise os 3 maiores concorrentes da empresa X e resuma.",
});

// Passo a passo conforme acontece:
for await (const event of run.stream()) {
  if (event.type === "assistant_text_delta") process.stdout.write(event.delta);
  if (event.type === "tool_call") console.log("→ usou:", event.tool_name);
}

// Ou só o resultado final:
const run2 = await volund.agents.run({ agentId: "agt_123", input: "Oi" });
const { output, usage } = await run2.result();
```

Continuar uma conversa (mesma thread):

```ts
const next = await volund.agents.continue({ runId: run.id, input: "E o 4º?" });
```

## A DX

Espelha o Cursor SDK (`Agent.create()` → `agent.send()` → `run.stream()`):
`new VolundOS()` → `agents.run()` → `run.stream()` / `run.result()` /
`run.cancel()`.

## Eventos (`VolundEvent`)

Stream tipado por união discriminada — faça narrowing por `event.type`:

| `type`                  | Campos                                            |
| ----------------------- | ------------------------------------------------- |
| `run_started`           | `protocol`, `run_id`, `agent_id`                  |
| `thinking_delta`        | `delta` (raciocínio, streaming)                   |
| `assistant_text_delta`  | `delta` (resposta, streaming)                     |
| `tool_call`             | `tool_call_id`, `tool_name`, `input`              |
| `tool_result`           | `tool_call_id`, `output`, `is_error?`             |
| `awaiting_input`        | `request_id`, `kind: "vault"` (HITL — fecha o stream) |
| `run_finished`          | `status`, `output`, `usage`, `error?`             |

O contrato é **snake_case no fio** (consistente com a API v1 e o ecossistema
Anthropic/Cursor) e versionado por `SCHEMA_VERSION` (`protocol` no `run_started`).

## Erros

Todos herdam de `VolundError` (tem `.code` e `.status`). Roteie por `instanceof`:

| Classe                      | Quando                                  |
| --------------------------- | --------------------------------------- |
| `VolundAuthError`           | 401 — chave ausente/inválida            |
| `VolundForbiddenError`      | 403 — sem acesso ao agente              |
| `VolundNotFoundError`       | 404 — agente/run inexistente            |
| `VolundRunBusyError`        | 409 — já há run ativo na thread         |
| `VolundRunFailedError`      | `run.result()` quando o run falha       |
| `VolundAwaitingInputError`  | `run.result()` quando pausa p/ vault    |

## Notas

- **`stream()` é consumível uma única vez** (é um stream de rede). Não combine
  `stream()` e `result()` no mesmo `Run`.
- `run.cancel()` aborta a conexão — o servidor encerra a sandbox.
- `execution: "local"` (rodar no `cwd` do dev, estilo Cursor) chega na **V2**; o
  tipo já existe, mas a V1 só roda na nuvem.

## Desenvolvimento

```bash
npm install
npm test              # testes do parser SSE (vitest)
npm run typecheck
npm run build         # tsdown → ESM + CJS + .d.ts
npm run check:protocol  # garante o contrato em sincronia com o volund-os
```

O contrato de eventos é **vendorado** de `volund-os` em `src/protocol/events.ts`
— ver [`src/protocol/README.md`](src/protocol/README.md). Atualize só via
`npm run sync:protocol`.

## Licença

MIT
