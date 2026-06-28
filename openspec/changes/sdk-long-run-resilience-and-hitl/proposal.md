# Change: sdk-long-run-resilience-and-hitl

> **Status: PROPOSTA (não implementar ainda).** Captura os itens do §3.5 da
> proposta-base ("Detalhes que NÃO podem ser esquecidos") que **ficaram para
> depois** no SDK, com o plano de como abordá-los. Não há código nesta change —
> só spec + design + tasks.

## Why

O §3.5 lista 6 detalhes críticos de runs longos e HITL. Durante a V1, a **maioria
já foi resolvida** (no servidor `volund-os` ou no próprio SDK). Restaram pontas de
**experiência completa de HITL** (retomar após pausa) e de **resiliência/observação
de runs muito longos** que valem ser registradas e planejadas antes de virarem
dívida esquecida.

Esta change **separa o que já está coberto** do que **falta**, e propõe o caminho
para os pendentes — sem fechar portas para a V2.

## Auditoria do §3.5 (o que já está coberto)

| Item §3.5 | Status | Onde |
|---|---|---|
| **Abort → `handle.kill()`** | ✅ Feito | Servidor (`sse-adapter` liga `req.signal`→kill) **e** SDK (`run.cancel()` + teardown ao abandonar o stream) |
| **Drain obrigatório** | ✅ Feito | Servidor (o adapter drena o stream inteiro, disparando persister/hooks) |
| **Heartbeat `: ping`** | ✅ Feito | Servidor envia a cada ~15s; o parser do SDK ignora comentários |
| **Concorrência `409 run_busy`** | ✅ Feito | SDK mapeia `409 → VolundRunBusyError`; backend passou a emitir (volund-os #163, CAS atômico) |
| **HITL — vault (`awaiting_input`)** | 🟡 Parcial | SDK **emite** `awaiting_input{kind:"vault"}` e fecha o stream; **falta** o helper de *retomar* (preencher o cofre + continuar) |
| **maxDuration / limites da Vercel** | 🟡 A confirmar | Rota usa `maxDuration=800`; falta **confirmar o teto do plano Vercel** e dar guidance no SDK p/ runs longos |

## What Changes (itens DEFERIDOS — escopo desta proposta)

- **[SDK] HITL completo — retomar após pausa.** Hoje o SDK só *avisa* (`awaiting_input`).
  Adicionar helpers tipados para o cliente **agir** (preencher vault / aprovar) via os
  endpoints já existentes do `volund-os`, e seguir observando.
- **[SDK, dep. backend] `awaiting_approval`.** Descopado da V1 (runs via API rodam com
  `bypassPermissions`). Reintroduzir `kind:"approval"` quando/se a API suportar pausa
  por aprovação.
- **[SDK/infra] Resiliência a runs longos.** Confirmar limites de `maxDuration` na
  plataforma de deploy; documentar e, se preciso, ajustar defaults/guidance de timeout
  do SDK (o timeout do SDK cobre só a fase **pré-stream**, não a duração do run).
- **[SDK, V2] Reconexão de stream.** Usar `id:` (já reservado no contrato) +
  `Last-Event-ID` para retomar o **mesmo** stream após queda de rede — o "tratamento
  sofisticado" que o §3.5 adiou.

## Impact

- **Affected specs:** `volund-sdk-client` (novos requisitos, ver `specs/`).
- **Affected code (quando implementar):** novos métodos no SDK (ex.: namespace
  `runs`/`vault`), sem quebrar a superfície atual. Possíveis mudanças **no backend**
  (`volund-os`) para approval-pause e suporte a reconexão — **cross-repo**.
- **Sem implementação nesta change.** Só planejamento.
- **Riscos:** alguns itens dependem do `volund-os` (não é só SDK); reconexão exige
  contrato de IDs estável.

## Como evoluir esta change (boas práticas OpenSpec)

Esta change é um **roadmap/backlog** dos itens deferidos do §3.5 — **não** uma
unidade implementável única. Por isso:

- **Spec e implementação em PRs SEPARADOS.** Este PR é **spec-only** (proposta, para
  revisão). Nenhum código entra aqui.
- Quando um item for priorizado, ele vira uma **change focada própria** (ex.:
  `add-sdk-vault-resume`), com sua própria proposta + implementação + `archive`.
  Assim cada unidade é pequena, revisável e arquivável de forma independente — em vez
  de prender este roadmap até o último item (V2) ficar pronto.
- Ao migrar um item para sua change focada, **referencie esta** como origem e marque o
  item correspondente aqui como "promovido para `<id-da-change>`".
