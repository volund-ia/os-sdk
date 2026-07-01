/**
 * Dogfooding ponta-a-ponta do fluxo HITL de APROVAÇÃO (tasks 3.1–3.5 da change
 * `sdk-long-run-resilience-and-hitl`). Rode contra um agente REAL que tenha uma
 * ferramenta com aprovação configurada pelo owner (senão o run nunca pausa):
 *
 *   VOLUND_API_KEY=vos_live_... VOLUND_AGENT_ID=<uuid> npx tsx examples/approval.ts
 *
 * Opcionais:
 *   VOLUND_BASE_URL=https://seu-preview.vercel.app   (default: produção)
 *   VERCEL_BYPASS=<secret>                            (Deployment Protection)
 *   APPROVAL_DECISION=approve|reject                  (default: approve)
 *   APPROVAL_INPUT="<prompt que aciona a ferramenta gated>"
 *
 * ┌─ Como o fluxo funciona (e por que o script é assim) ──────────────────────┐
 * │ 1. `run.stream()` emite eventos até a ferramenta gated: aí o servidor      │
 * │    pausa (status `awaiting_approval`), emite `awaiting_input{kind:          │
 * │    "approval", request_id}` e FECHA o stream.                              │
 * │ 2. `volund.approvals.approve(request_id)` (ou `.reject`) decide. O backend  │
 * │    chama `resumeAgentAfterDecision` e o run RETOMA em background — NÃO na   │
 * │    conexão SSE anterior (ela já fechou).                                    │
 * │ 3. Para OBSERVAR a retomada, reabrimos o stream via `agents.continue`.      │
 * │    Enquanto o run retomado ainda está ativo, `continue` responde           │
 * │    `409 run_busy` (→ `VolundRunBusyError`); por isso fazemos retry curto    │
 * │    até a thread liberar. `continue` exige um `input` novo — usamos uma      │
 * │    nudge neutra só para reanexar e ver a thread avançar.                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import { VolundOS, VolundRunBusyError } from "../src/index";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const apiKey = process.env.VOLUND_API_KEY;
  const agentId = process.env.VOLUND_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new Error("Defina VOLUND_API_KEY e VOLUND_AGENT_ID no ambiente.");
  }

  const baseUrl = process.env.VOLUND_BASE_URL;
  const bypass = process.env.VERCEL_BYPASS;
  const decision = (process.env.APPROVAL_DECISION ?? "approve") as "approve" | "reject";
  const input =
    process.env.APPROVAL_INPUT ??
    "Use a ferramenta que exige aprovação para completar esta tarefa.";

  const volund = new VolundOS({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(bypass ? { defaultHeaders: { "x-vercel-protection-bypass": bypass } } : {}),
  });

  // ── 1. dispara o run e consome o stream até a pausa ─────────────────────────
  const run = await volund.agents.run({ agentId, input });

  let pendingApprovalId: string | null = null;

  for await (const event of run.stream()) {
    switch (event.type) {
      case "run_started":
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
        if (event.kind === "approval") {
          pendingApprovalId = event.request_id;
          console.log(`\n⏸ pausou aguardando APROVAÇÃO (${event.request_id})`);
        } else {
          console.log(`\n⏸ pausou aguardando ${event.kind} (${event.request_id})`);
        }
        break;
      case "run_finished":
        console.log(`\n■ ${event.status} — tokens:`, event.usage);
        break;
    }
  }

  if (!pendingApprovalId) {
    console.log(
      "\nO run terminou sem pedir aprovação. Confirme que o agente tem uma " +
        "ferramenta com aprovação configurada e que o prompt a aciona."
    );
    return;
  }

  // ── 2. decide (approve/reject) ──────────────────────────────────────────────
  console.log(`\n\x1b[1m${decision === "approve" ? "✔ aprovando" : "✗ rejeitando"} ${pendingApprovalId}…\x1b[0m`);
  const result =
    decision === "approve"
      ? await volund.approvals.approve(pendingApprovalId)
      : await volund.approvals.reject(pendingApprovalId, { note: "reprovado no dogfooding" });
  console.log("decisão registrada:", result);

  // ── 3. reabre o stream para observar a retomada (retry no 409 run_busy) ─────
  console.log("\n↻ reanexando à thread para ver a retomada…");
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resumed = await volund.agents.continue({
        runId: run.id,
        input: "(continue)",
      });
      for await (const event of resumed.stream()) {
        if (event.type === "assistant_text_delta") process.stdout.write(event.delta);
        if (event.type === "tool_call") console.log(`\n→ ferramenta: ${event.tool_name}`);
        if (event.type === "run_finished") console.log(`\n■ ${event.status}`);
      }
      return;
    } catch (err) {
      if (err instanceof VolundRunBusyError && attempt < maxAttempts) {
        console.log(`  (thread ainda ocupada — tentativa ${attempt}/${maxAttempts})`);
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }
  console.log("A thread seguiu ocupada; o run retomado ainda está executando no servidor.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
