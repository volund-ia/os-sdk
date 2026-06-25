/**
 * Testa o atalho `run.result()` — espera o run terminar e devolve só o texto
 * final + usage, sem você iterar eventos.
 *   npx tsx examples/edge-result.ts
 */
import { VolundOS } from "../src/index";

async function main() {
  const apiKey = process.env.VOLUND_API_KEY!;
  const agentId = process.env.VOLUND_AGENT_ID!;
  const baseUrl = process.env.VOLUND_BASE_URL;
  const volund = new VolundOS({ apiKey, ...(baseUrl ? { baseUrl } : {}) });

  const run = await volund.agents.run({
    agentId,
    input: "Em uma frase: o que é o Pix?",
  });

  console.log("Aguardando result()...");
  const { output, usage } = await run.result();
  console.log("\n=== OUTPUT ===\n" + output);
  console.log("\n=== USAGE ===", usage);
}
main().catch((e) => { console.error(e); process.exit(1); });
