/**
 * Testa `run.cancel()` — aborta a conexão no meio do stream; o servidor mata a
 * sandbox. Esperado: o loop encerra logo após o cancel, sem run_finished.
 *   npx tsx examples/edge-cancel.ts
 */
import { VolundOS } from "../src/index";

async function main() {
  const apiKey = process.env.VOLUND_API_KEY!;
  const agentId = process.env.VOLUND_AGENT_ID!;
  const baseUrl = process.env.VOLUND_BASE_URL;
  const volund = new VolundOS({ apiKey, ...(baseUrl ? { baseUrl } : {}) });

  const run = await volund.agents.run({
    agentId,
    input: "Pesquise em detalhes a história completa do Banco do Brasil, ano a ano.",
  });

  // Cancela depois de 3s — no meio do raciocínio/pesquisa.
  const timer = setTimeout(() => {
    console.log("\n\n>>> chamando run.cancel() <<<\n");
    run.cancel();
  }, 3000);

  let n = 0;
  try {
    for await (const ev of run.stream()) {
      if (ev.type === "thinking_delta" || ev.type === "assistant_text_delta") {
        process.stdout.write(".");
      }
      n++;
    }
    console.log(`\nStream encerrou normalmente após ${n} eventos.`);
  } catch (err) {
    console.log(`\nStream interrompido (esperado no cancel): ${(err as Error).name}`);
  } finally {
    clearTimeout(timer);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
