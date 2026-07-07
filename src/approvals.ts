/**
 * `volund.approvals` — decidir aprovações HITL por código.
 *
 * Quando um run pausa por aprovação, o stream emite
 * `awaiting_input{kind:"approval", request_id}`. O `request_id` é o id da
 * aprovação — passe-o aqui para aprovar/rejeitar e o run **retoma**.
 *
 *   for await (const ev of run.stream()) {
 *     if (ev.type === "awaiting_input" && ev.kind === "approval") {
 *       await volund.approvals.approve(ev.request_id);
 *     }
 *   }
 *
 * Espelha o endpoint `POST /api/v1/approvals/{id}/decide` (volund-os#175).
 */

import { postJson, type HttpConfig } from "./http";

export type ApprovalDecision = "approve" | "reject";

export interface DecideOptions {
  /** Justificativa — usada só em `reject` (o servidor capa em 500 chars). */
  note?: string;
  /** Cancela a requisição. */
  signal?: AbortSignal;
}

/** Resposta do servidor ao decidir (shape opaco — `{ approval: ... }`). */
export interface DecideResult {
  approval: unknown;
}

export class Approvals {
  #http: HttpConfig;

  constructor(http: HttpConfig) {
    this.#http = http;
  }

  /**
   * Decide uma aprovação pausada. `approvalId` = o `request_id` do evento
   * `awaiting_input{kind:"approval"}`.
   */
  async decide(
    approvalId: string,
    decision: ApprovalDecision,
    opts: DecideOptions = {}
  ): Promise<DecideResult> {
    const body: { decision: ApprovalDecision; note?: string } = { decision };
    if (decision === "reject" && opts.note !== undefined) body.note = opts.note;

    const path = `/api/v1/approvals/${encodeURIComponent(approvalId)}/decide`;
    return postJson<DecideResult>(this.#http, path, body, opts.signal);
  }

  /** Atalho para `decide(id, "approve")`. */
  approve(approvalId: string, opts: { signal?: AbortSignal } = {}): Promise<DecideResult> {
    return this.decide(approvalId, "approve", opts);
  }

  /** Atalho para `decide(id, "reject", { note })`. */
  reject(approvalId: string, opts: DecideOptions = {}): Promise<DecideResult> {
    return this.decide(approvalId, "reject", opts);
  }
}
