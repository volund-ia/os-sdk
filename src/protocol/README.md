# `src/protocol/` — fronteira de fonte única

`events.ts` aqui é uma **cópia vendorada** de
`lib/agent/connectors/api/events.ts` do repo `volund-os` — a fonte única do
contrato `VolundEvent` v1.

## Regras

- **Não edite `events.ts` à mão** abaixo do sentinel `BEGIN VENDORED CONTRACT`.
- Para atualizar: `npm run sync:protocol` (copia do `volund-os`).
- O CI roda `npm run check:protocol`, que **falha** se o corpo divergir do
  upstream — garante que servidor e SDK nunca saiam de sincronia.
- Este diretório **não importa nada do resto do SDK**. Isso mantém aberta a
  porta de promovê-lo a um pacote publicado (`@volund/protocol`) sem refactor.

## Por que vendorar em vez de publicar um pacote agora

Zero overhead de pipeline de publicação no dia 1, e o drift-guard dá a mesma
garantia prática de "fonte única". Quando o contrato estabilizar e houver mais
consumidores, extrair para `@volund/protocol` é trivial.
