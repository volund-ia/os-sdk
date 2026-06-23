#!/usr/bin/env node
/**
 * Re-sincroniza `src/protocol/events.ts` a partir da fonte única no `volund-os`.
 * Preserva o banner vendorado (tudo até o sentinel) e substitui o corpo pela
 * cópia byte-a-byte do upstream. Único jeito autorizado de atualizar o contrato.
 *
 * Fonte: env VOLUND_OS_DIR, ou o repo irmão `../volund-os` por padrão.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SENTINEL = "BEGIN VENDORED CONTRACT";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = process.env.VOLUND_OS_DIR
  ? resolve(process.env.VOLUND_OS_DIR)
  : resolve(repoRoot, "..", "volund-os");
const upstreamPath = resolve(sourceDir, "lib/agent/connectors/api/events.ts");
const vendoredPath = resolve(repoRoot, "src/protocol/events.ts");

if (!existsSync(upstreamPath)) {
  console.error(
    `[sync:protocol] fonte não encontrada em ${upstreamPath}.\n` +
      `  Defina VOLUND_OS_DIR ou clone o volund-os como repo irmão.`
  );
  process.exit(1);
}

const current = readFileSync(vendoredPath, "utf8");
const i = current.indexOf(SENTINEL);
if (i === -1) {
  console.error(`[sync:protocol] sentinel "${SENTINEL}" ausente em ${vendoredPath}.`);
  process.exit(1);
}
const headerEnd = current.indexOf("\n", i) + 1;
const banner = current.slice(0, headerEnd);
const upstream = readFileSync(upstreamPath, "utf8");

writeFileSync(vendoredPath, banner + upstream, "utf8");
console.log(`[sync:protocol] OK — contrato sincronizado de ${upstreamPath}.`);
