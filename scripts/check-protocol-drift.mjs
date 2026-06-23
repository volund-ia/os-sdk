#!/usr/bin/env node
/**
 * Drift-guard do contrato. Compara o corpo vendorado de
 * `src/protocol/events.ts` (abaixo do sentinel) com a fonte única no `volund-os`.
 * Falha (exit 1) se divergirem — é o que mantém servidor e SDK em sincronia.
 *
 * Fonte: env VOLUND_OS_DIR, ou o repo irmão `../volund-os` por padrão.
 * Se a fonte não existir (ex.: CI sem checkout do volund-os), avisa e passa —
 * o guard só BLOQUEIA quando consegue comparar de fato.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SENTINEL = "BEGIN VENDORED CONTRACT";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = process.env.VOLUND_OS_DIR
  ? resolve(process.env.VOLUND_OS_DIR)
  : resolve(repoRoot, "..", "volund-os");
const upstreamPath = resolve(sourceDir, "lib/agent/connectors/api/events.ts");
const vendoredPath = resolve(repoRoot, "src/protocol/events.ts");

const norm = (s) => s.replace(/\r\n/g, "\n").trimEnd();
const bodyAfterSentinel = (s) => {
  const i = s.indexOf(SENTINEL);
  if (i === -1) return null;
  return s.slice(s.indexOf("\n", i) + 1);
};

if (!existsSync(upstreamPath)) {
  console.warn(
    `[check:protocol] fonte não encontrada em ${upstreamPath} — pulei o diff.\n` +
      `  Defina VOLUND_OS_DIR ou clone o volund-os como repo irmão para validar.`
  );
  process.exit(0);
}

const upstream = norm(readFileSync(upstreamPath, "utf8"));
const vendoredBody = bodyAfterSentinel(readFileSync(vendoredPath, "utf8"));
if (vendoredBody == null) {
  console.error(`[check:protocol] sentinel "${SENTINEL}" ausente em ${vendoredPath}.`);
  process.exit(1);
}

if (norm(vendoredBody) === upstream) {
  console.log("[check:protocol] OK — contrato em sincronia com o volund-os.");
  process.exit(0);
}

console.error(
  "[check:protocol] DRIFT detectado: src/protocol/events.ts difere do upstream.\n" +
    "  Rode `npm run sync:protocol` para re-sincronizar (e revise a mudança)."
);
process.exit(1);
