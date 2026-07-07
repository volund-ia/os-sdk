# Spec delta: volund-sdk-client (idle timeout)

## ADDED Requirements

### Requirement: Idle timeout de streaming
O SDK SHALL oferecer um `idleTimeoutMs` opcional que aborta o run se NENHUM byte
(evento ou heartbeat) chegar dentro do intervalo durante o streaming. É distinto do
`timeoutMs` (pré-stream) e NÃO limita a duração total do run. Default: desligado.

#### Scenario: stream ocioso além do limite
- **WHEN** `idleTimeoutMs` está configurado e nenhum dado chega por mais que esse intervalo
- **THEN** o stream é abortado e o consumidor recebe um `VolundError` com `code: "timeout"`
- **AND** a conexão é fechada (o servidor encerra o sandbox)

#### Scenario: heartbeat reseta o ocioso
- **WHEN** chegam heartbeats `: ping` em intervalos menores que `idleTimeoutMs`, mesmo sem eventos
- **THEN** o run NÃO é abortado (heartbeat conta como atividade)

#### Scenario: idle timeout desligado
- **WHEN** `idleTimeoutMs` não é informado
- **THEN** nenhum timeout de ociosidade é aplicado, por mais longo que seja o silêncio
