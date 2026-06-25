/**
 * @volund-ia/sdk — cliente TypeScript para rodar agentes do Volund OS e receber,
 * em tempo real (streaming), tudo que o agente faz.
 *
 *   import { VolundOS } from "@volund-ia/sdk";
 *   const volund = new VolundOS({ apiKey: process.env.VOLUND_API_KEY! });
 *   const run = await volund.agents.run({ agentId: "agt_123", input: "..." });
 *   for await (const ev of run.stream()) {
 *     if (ev.type === "assistant_text_delta") process.stdout.write(ev.delta);
 *   }
 */

// Cliente e operações
export { VolundOS, type VolundOSConfig } from "./client";
export { Agents, type RunOptions, type ContinueOptions } from "./agents";
export { Run, type RunResult } from "./run";

// Parser SSE (útil p/ quem consome a API diretamente, sem o cliente)
export { parseVolundSSE } from "./sse";

// Erros
export {
  VolundError,
  VolundAuthError,
  VolundForbiddenError,
  VolundNotFoundError,
  VolundRunBusyError,
  VolundRunFailedError,
  VolundAwaitingInputError,
  errorFromApiResponse,
  type AnyVolundErrorCode,
  type VolundClientErrorCode,
} from "./errors";

// Contrato público de eventos e entradas (fonte única — ver src/protocol)
export {
  SCHEMA_VERSION,
  type VolundEvent,
  type VolundEventType,
  type RunStartedEvent,
  type ThinkingDeltaEvent,
  type AssistantTextDeltaEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type AwaitingInputEvent,
  type RunFinishedEvent,
  type VolundFileInput,
  type ExecutionMode,
  type RunInput,
  type ContinueInput,
  type VolundErrorCode,
} from "./protocol/events";
