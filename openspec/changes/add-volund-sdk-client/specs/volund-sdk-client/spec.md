# Spec delta: volund-sdk-client

## ADDED Requirements

### Requirement: Cliente e autenticação
O pacote SHALL expor uma classe `VolundOS` construída com `{ apiKey, baseUrl?, fetch? }`,
que injeta `Authorization: Bearer <apiKey>` em toda requisição e usa
`https://os.volund.com.br` como `baseUrl` padrão.

#### Scenario: apiKey ausente
- **WHEN** `new VolundOS()` é chamado sem `apiKey`
- **THEN** lança `VolundError` com `code: "missing_api_key"`

#### Scenario: baseUrl customizada
- **WHEN** `baseUrl` é informada
- **THEN** todas as requisições usam essa origem em vez do default

### Requirement: Disparar run com streaming
`volund.agents.run({ agentId, input, files? })` SHALL fazer
`POST /api/v1/agents/{agentId}/stream` e resolver para um `Run` cujo `.stream()`
itera `VolundEvent` na ordem em que chegam.

#### Scenario: run novo bem-sucedido
- **WHEN** a API responde `200 text/event-stream`
- **THEN** `run.stream()` emite `run_started` primeiro, depois os deltas/tool
  events, e `run_finished` por último

#### Scenario: arquivos anexados
- **WHEN** `files` é informado
- **THEN** o corpo do POST inclui `files` no shape `{ url } | { data }`

### Requirement: Continuar run com streaming
`volund.agents.continue({ runId, input, files? })` SHALL fazer
`POST /api/v1/runs/{runId}/stream` e resolver para um `Run` com o mesmo formato.

#### Scenario: continuação
- **WHEN** chamado com um `runId` existente
- **THEN** devolve um `Run` que strema a resposta da thread continuada

### Requirement: Consumo do stream tipado
`Run.stream()` SHALL devolver um `AsyncIterable<VolundEvent>` consumível UMA vez.

#### Scenario: narrowing por type
- **WHEN** o consumidor faz `for await` e checa `event.type`
- **THEN** cada variante expõe seus campos tipados (snake_case)

#### Scenario: consumo duplo
- **WHEN** `stream()` (ou `result()`) é chamado uma segunda vez no mesmo `Run`
- **THEN** lança `VolundError` com `code: "stream_error"`

### Requirement: Atalho `result()`
`Run.result()` SHALL consumir o stream e devolver `{ output, usage }` no caminho feliz.

#### Scenario: run concluído
- **WHEN** o stream termina com `run_finished status:"completed"`
- **THEN** resolve com `output` (texto final) e `usage`

#### Scenario: run falhou
- **WHEN** o stream termina com `run_finished status:"failed"`
- **THEN** lança `VolundRunFailedError` com a mensagem de `error`

#### Scenario: run pausou (vault)
- **WHEN** o stream emite `awaiting_input`
- **THEN** `result()` lança `VolundAwaitingInputError` com `request_id` e `kind`

### Requirement: Cancelamento
`Run.cancel()` SHALL abortar a conexão de rede do run.

#### Scenario: cancelar run em andamento
- **WHEN** `run.cancel()` é chamado durante o streaming
- **THEN** a requisição é abortada (e o servidor encerra a sandbox)

### Requirement: Parser SSE robusto
O parser SHALL produzir os mesmos `VolundEvent` independentemente de como os
bytes são fatiados, ignorando heartbeats e frames não reconhecidos.

#### Scenario: heartbeat
- **WHEN** chega `: ping\n\n` entre eventos
- **THEN** nenhum evento é emitido para o heartbeat

#### Scenario: frame partido entre chunks
- **WHEN** um frame `data:` é dividido no meio entre dois chunks de rede
- **THEN** o evento é emitido íntegro, uma única vez

#### Scenario: tipo desconhecido ou JSON inválido
- **WHEN** chega um `data:` com `type` desconhecido ou JSON malformado
- **THEN** o frame é ignorado (forward-compat) sem lançar

### Requirement: Mapeamento de erros pré-stream
Respostas de erro (status normal + JSON `{ error, message }`) SHALL virar
subclasses tipadas de `VolundError`, detectadas antes de qualquer parsing de SSE.

#### Scenario: chave inválida
- **WHEN** a API responde `401 { error: "invalid_api_key" }`
- **THEN** `agents.run()` rejeita com `VolundAuthError`

#### Scenario: thread ocupada
- **WHEN** a API responde `409 { error: "run_busy" }`
- **THEN** `agents.continue()` rejeita com `VolundRunBusyError`

#### Scenario: resposta não-stream em sucesso aparente
- **WHEN** o status é `200` mas o `content-type` não é `text/event-stream`
- **THEN** o SDK trata como erro (não tenta parsear como SSE)

### Requirement: Gancho de execução (V2)
A API SHALL aceitar `execution?` no shape do contrato, mas rejeitar valores não
suportados na V1.

#### Scenario: execução local não suportada
- **WHEN** `run({ ..., execution: { local: { cwd } } })` é chamado
- **THEN** lança `VolundError` com `code: "unsupported"`

### Requirement: Paridade do contrato (drift-guard)
O repositório SHALL falhar o CI se `src/protocol/events.ts` divergir da fonte
única em `volund-os`.

#### Scenario: contrato divergente
- **WHEN** o corpo vendorado abaixo do sentinel difere do upstream
- **THEN** `npm run check:protocol` sai com código 1
