# Projeto: @volund-ia/sdk — convenções OpenSpec

Spec-driven development para o pacote cliente do Volund OS (Parte B do plano
`@volund-ia/sdk`). A Parte A (servidor, rotas `/stream` + contrato `VolundEvent`)
já está implementada no repo `volund-os`.

- **Mudanças** ficam em `openspec/changes/<id>/` com `proposal.md`, `design.md`,
  `tasks.md` e o delta de spec em `specs/<capability>/spec.md`.
- **Specs estabelecidas** (já implementadas) ficam em `openspec/specs/`.
- O contrato de eventos é **fonte única no `volund-os`** e vendorado aqui em
  `src/protocol/events.ts`. NÃO especifique mudanças no contrato neste repo —
  elas pertencem ao `volund-os`. Aqui só consumimos.
- Com o CLI do OpenSpec: `openspec validate <id>` e `openspec archive <id>`
  quando a mudança for implementada.
