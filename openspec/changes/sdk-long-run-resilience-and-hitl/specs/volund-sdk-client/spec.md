# Spec delta: volund-sdk-client (runs longos + HITL completo)

> Requisitos **propostos** (deferidos). Esta change não está implementada — quando
> for, cada requisito vira parte da capability estabelecida.

## ADDED Requirements

### Requirement: Retomar run após pausa de vault
O SDK SHALL oferecer um caminho tipado para o cliente **preencher o cofre (vault)**
após receber `awaiting_input{kind:"vault"}` e então **retomar a observação** do run,
usando os endpoints já existentes do Volund OS — sem o cliente montar requisições cruas.

#### Scenario: preencher vault e continuar
- **WHEN** o stream emite `awaiting_input` com `kind:"vault"` e um `request_id`
- **THEN** o cliente pode chamar um helper do SDK (ex.: `runs.submitVault(runId, requestId, payload)`) que envia o preenchimento ao endpoint existente
- **AND** em seguida reabrir o stream do mesmo run (via `agents.continue`) para seguir observando

#### Scenario: erro ao submeter vault
- **WHEN** o endpoint de vault responde erro (ex.: request inválido/expirado)
- **THEN** o helper rejeita com uma subclasse tipada de `VolundError`

### Requirement: Suporte a aprovação (awaiting_approval)
QUANDO a API pública passar a suportar pausa por aprovação, o SDK SHALL expor
`awaiting_input` com `kind:"approval"` e um helper para decidir a aprovação.

Nota: descopado da V1 (runs via API usam `bypassPermissions`). Depende de mudança
no backend `volund-os` e de bump de `SCHEMA_VERSION`.

#### Scenario: run pausa para aprovação
- **WHEN** o backend pausa o run aguardando aprovação e emite o evento correspondente
- **THEN** o SDK entrega `awaiting_input{kind:"approval", request_id}` e oferece um helper (ex.: `runs.approve(runId, approvalId, decision)`)

### Requirement: Clareza sobre duração de runs longos
O SDK SHALL deixar explícito que o `timeoutMs` cobre apenas a fase **pré-stream**
(receber a resposta), não a duração total do run, e documentar o limite efetivo da
plataforma de deploy.

#### Scenario: timeout não derruba run em andamento
- **WHEN** um run leva mais que `timeoutMs` para concluir, mas já começou a stremar
- **THEN** o timeout NÃO aborta o stream (já garantido na V1); a duração máxima passa a depender do limite do servidor/plataforma

#### Scenario: idle timeout opcional (futuro)
- **WHEN** (opt-in) o cliente configura um *idle timeout* e o stream fica N segundos sem nenhum evento
- **THEN** o SDK aborta a conexão com um erro de timeout dedicado

### Requirement: Reconexão de stream (V2)
O SDK SHALL, na V2 e como opt-in, retomar o **mesmo** run após queda de rede usando
`Last-Event-ID`, dependente de o servidor suportar replay a partir do último `id`.

#### Scenario: retomar após queda
- **WHEN** a conexão cai no meio de um run e o cliente habilitou reconexão
- **THEN** o SDK reabre o stream enviando `Last-Event-ID` do último evento recebido
- **AND** o servidor reenvia os eventos a partir daquele ponto (sem duplicar o que já foi entregue)
