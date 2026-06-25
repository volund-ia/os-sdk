/**
 * Dogfooding multi-turn (task 6.1): valida `agents.run` → `agents.continue`
 * na MESMA thread, e o backfill do `run.id` a partir do `run_started`.
 *
 *   VOLUND_API_KEY=vos_live_... VOLUND_AGENT_ID=... npx tsx examples/multiturn.ts
 */
import { VolundOS } from "../src/index";
import type { VolundEvent } from "../src/protocol/events";

/** Imprime os eventos de um stream de forma legível e devolve o run_id visto. */
async function consume(label: string, stream: AsyncIterable<VolundEvent>): Promise<string> {
  console.log(`\n===== ${label} =====`);
  let runId = "";
  for await (const event of stream) {
    switch (event.type) {
      case "run_started":
        runId = event.run_id;
        console.log(`▶ run ${event.run_id} (protocolo ${event.protocol})`);
        break;
      case "thinking_delta":
        process.stdout.write(`\x1b[2m${event.delta}\x1b[0m`);
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
  return runId;
}

async function main() {
  const apiKey = process.env.VOLUND_API_KEY;
  const agentId = process.env.VOLUND_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new Error("Defina VOLUND_API_KEY e VOLUND_AGENT_ID no ambiente.");
  }

  const baseUrl = process.env.VOLUND_BASE_URL;
  const bypass = process.env.VERCEL_BYPASS;
  const volund = new VolundOS({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(bypass ? { defaultHeaders: { "x-vercel-protection-bypass": bypass } } : {}),
  });

  // --- Turno 1: abre uma thread nova ---
  const run1 = await volund.agents.run({
    agentId,
    input: "Pesquise os 3 maiores concorrentes da Nubank e resuma cada um em uma linha.",
  });
  await consume("TURNO 1 (run)", run1.stream());

  const runId = run1.id; // preenchido pelo run_started durante o stream acima
  console.log(`\n[thread id capturado: ${runId}]`);
  if (!runId) throw new Error("run.id ficou vazio — backfill do run_started falhou.");

  // --- Turno 2: continua a MESMA thread (o agente lembra do contexto acima) ---
  const run2 = await volund.agents.continue({
    runId,
    input: "Desses três, qual tem o maior valuation hoje? Responda em uma frase.",
  });
  await consume("TURNO 2 (continue)", run2.stream());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
