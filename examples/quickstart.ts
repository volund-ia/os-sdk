/**
 * Dogfooding ponta-a-ponta (§5 passo 8 do plano). Rode contra um agente real:
 *
 *   VOLUND_API_KEY=vos_live_... VOLUND_AGENT_ID=<uuid> npx tsx examples/quickstart.ts
 *
 * VOLUND_AGENT_ID é o UUID do agente, SEM prefixo (a API não aceita "agt_<uuid>").
 */
import { VolundOS } from "../src/index";

async function main() {
  const apiKey = process.env.VOLUND_API_KEY;
  const agentId = process.env.VOLUND_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new Error("Defina VOLUND_API_KEY e VOLUND_AGENT_ID no ambiente.");
  }

  const baseUrl = process.env.VOLUND_BASE_URL; // opcional (default: produção)
  // Para testar contra um preview da Vercel com Deployment Protection ligada:
  // VERCEL_BYPASS=<secret do Protection Bypass for Automation>
  const bypass = process.env.VERCEL_BYPASS;
  const volund = new VolundOS({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(bypass ? { defaultHeaders: { "x-vercel-protection-bypass": bypass } } : {}),
  });

  const run = await volund.agents.run({
    agentId,
    input: "Pesquise os 3 maiores concorrentes da empresa X e resuma.",
  });

  for await (const event of run.stream()) {
    switch (event.type) {
      case "run_started":
        console.log(`▶ run ${event.run_id} (protocolo ${event.protocol})`);
        break;
      case "thinking_delta":
        process.stdout.write(`\x1b[2m${event.delta}\x1b[0m`); // raciocínio (esmaecido)
        break;
      case "assistant_text_delta":
        process.stdout.write(event.delta);
        break;
      case "tool_call":
        console.log(`\n→ ferramenta: ${event.tool_name}`, event.input);
        break;
      case "tool_result":
        console.log(`← resultado${event.is_error ? " (erro)" : ""}`);
        break;
      case "awaiting_input":
        console.log(`\n⏸ pausou aguardando ${event.kind} (${event.request_id})`);
        break;
      case "run_finished":
        console.log(`\n■ ${event.status} — tokens:`, event.usage);
        break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
