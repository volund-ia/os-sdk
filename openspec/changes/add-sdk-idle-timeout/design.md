# Design — add-sdk-idle-timeout

## Decisão central: ociosidade no nível de BYTES, não de eventos

O idle timeout precisa resetar em **qualquer** atividade da conexão — inclusive
heartbeats (`: ping`), que o servidor manda ~15s para manter a conexão viva durante
silêncios (ex.: ferramenta demorando). Heartbeats são **comentários SSE**: o parser
os ignora, então eles **não viram `VolundEvent`**.

Consequência: se o timer resetasse por *evento*, um run saudável que está só
esperando uma ferramenta (sem eventos, mas com heartbeats) seria morto por engano.
Por isso a guarda fica no **read loop** (`parseVolundSSE`), que vê os bytes crus —
cada `reader.read()` com dados (evento OU heartbeat) reseta o timer.

## Implementação

- `parseVolundSSE(body, { idleTimeoutMs })`: cada leitura passa por `readChunk`,
  que corre `reader.read()` contra um `setTimeout(idleMs)`. Se o timer vence:
  `reader.cancel()` (fecha a conexão) + rejeita com `VolundError{code:"timeout"}`.
- O erro propaga até `Run.stream()`, cujo `catch`/`finally` já existente:
  - não é abort do usuário → **re-lança** o timeout pro consumidor;
  - não é estado terminal → o `finally` chama `this.#abort.abort()` (fecha a conexão
    → servidor mata o sandbox). Reaproveita o teardown do PR de orphan-sandbox.
- Plumbing: `client → http (HttpConfig.idleTimeoutMs) → agents → new Run({idleTimeoutMs}) → parseVolundSSE`.

## Por que NÃO no `Run` por evento
Tentar medir ociosidade contando `VolundEvent` ignoraria heartbeats → falso-positivo
em runs longos. O nível de bytes é o único correto.

## Armadilha tratada
`reader.releaseLock()` lança se houver `read()` pendente. No caminho de timeout,
`reader.cancel()` **settla** a leitura pendente antes do `finally`, então o
`releaseLock()` não estoura.

## Testes (TDD — escritos antes)
`tests/idle-timeout.test.ts`, com timers reais e atrasos curtos (determinístico):
1. ocioso além do limite → `code:"timeout"`;
2. heartbeats resetam → não estoura;
3. sem `idleTimeoutMs` → nunca estoura;
4. ponta-a-ponta via `VolundOS`: consumidor recebe timeout **e** a conexão é abortada.
