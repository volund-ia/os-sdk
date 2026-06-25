/**
 * Testa o 409 `run_busy` — tentar `continue` numa thread que ainda tem um run
 * ativo. Esperado: VolundRunBusyError (code "run_busy", status 409).
 *   npx tsx examples/edge-busy.ts
 */
import { VolundOS, VolundRunBusyError } from "../src/index";

async function main() {
  const apiKey = process.env.VOLUND_API_KEY!;
  const agentId = process.env.VOLUND_AGENT_ID!;
  const baseUrl = process.env.VOLUND_BASE_URL;
  const volund = new VolundOS({ apiKey, ...(baseUrl ? { baseUrl } : {}) });

  // Turno 1 — NÃO consumимos até o fim: deixamos o run ativo de propósito.
  const run = await volund.agents.run({
    agentId,
    input: "Pesquise e escreva um relatório longo sobre o sistema financeiro brasileiro.",
  });

  // Precisamos do run.id, que só chega no run_started. Lemos só o 1º evento.
  const it = run.stream()[Symbol.asyncIterator]();
  let runId = run.id;
  while (!runId) {
    const { value } = await it.next();
    if (value?.type === "run_started") runId = value.run_id;
  }
  console.log(`Thread ativa: ${runId} — tentando continue em paralelo...`);

  // Turno 2 na MESMA thread, enquanto o turno 1 ainda roda → deve dar 409.
  try {
    await volund.agents.continue({ runId, input: "interrompe e responde rápido" });
    console.log("❌ Não deu erro — esperava run_busy.");
  } catch (err) {
    if (err instanceof VolundRunBusyError) {
      console.log(`✅ run_busy como esperado (status ${err.status}, code ${err.code}).`);
    } else {
      console.log(`⚠ Erro diferente: ${(err as Error).name} — ${(err as Error).message}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
