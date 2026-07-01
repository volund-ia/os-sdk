import { describe, expect, it } from "vitest";

import { VolundOS } from "../src/client";
import { VolundError, VolundForbiddenError, VolundNotFoundError } from "../src/errors";

/**
 * TDD do helper de aprovação HITL (`volund.approvals`). É **independente do
 * contrato de eventos** — só faz POST no endpoint `/api/v1/approvals/{id}/decide`
 * (criado na PR volund-os#175). Por isso dá pra escrever/testar antes do
 * `sync:protocol` que trará o `kind:"approval"`.
 */

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(handler: () => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: typeof input === "string" ? input : input.toString(), init: init ?? {} });
    return handler();
  }) as typeof fetch;
  return { fetch: fn, calls };
}

describe("approvals.approve / reject / decide", () => {
  it("approve → POST no endpoint certo, com auth e body {decision:'approve'}", async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, { approval: { id: "ap_1", status: "approved" } })
    );
    const volund = new VolundOS({ apiKey: "k", baseUrl: "https://api.test", fetch });

    const r = await volund.approvals.approve("ap_1");

    expect(calls[0]!.url).toBe("https://api.test/api/v1/approvals/ap_1/decide");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ decision: "approve" });
    expect(r).toEqual({ approval: { id: "ap_1", status: "approved" } });
  });

  it("reject com nota → body {decision:'reject', note}", async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, { approval: {} }));
    const volund = new VolundOS({ apiKey: "k", fetch });

    await volund.approvals.reject("ap_2", { note: "não autorizado" });

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      decision: "reject",
      note: "não autorizado",
    });
  });

  it("reject sem nota → body só com decision", async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, { approval: {} }));
    const volund = new VolundOS({ apiKey: "k", fetch });

    await volund.approvals.reject("ap_3");

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ decision: "reject" });
  });

  it("decide usa a baseUrl default quando não informada", async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, { approval: {} }));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await volund.approvals.decide("ap_4", "approve");
    expect(calls[0]!.url).toBe("https://os.volund.com.br/api/v1/approvals/ap_4/decide");
  });

  it("403 → VolundForbiddenError", async () => {
    const { fetch } = mockFetch(() => jsonResponse(403, { error: "forbidden", message: "x" }));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(volund.approvals.approve("ap")).rejects.toBeInstanceOf(VolundForbiddenError);
  });

  it("404 not_found → erro com status 404", async () => {
    const { fetch } = mockFetch(() => jsonResponse(404, { error: "not_found", message: "x" }));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(volund.approvals.approve("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("409 already_decided → erro com status 409 e code", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(409, { error: "already_decided", message: "x", status: "approved" })
    );
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(volund.approvals.approve("ap")).rejects.toMatchObject({
      status: 409,
      code: "already_decided",
    });
  });
});

describe("result() com awaiting_input{kind:'approval'}", () => {
  it("lança VolundAwaitingInputError carregando kind e request_id", async () => {
    const enc = new TextEncoder();
    const wire =
      `data: ${JSON.stringify({ type: "run_started", protocol: "v1", run_id: "t1", agent_id: "a" })}\n\n` +
      `data: ${JSON.stringify({ type: "awaiting_input", request_id: "req_1", kind: "approval" })}\n\n`;
    const sse = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(wire));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
    const fetchImpl = (async () => sse) as typeof fetch;
    const volund = new VolundOS({ apiKey: "k", fetch: fetchImpl });
    const run = await volund.agents.run({ agentId: "a", input: "x" });
    await expect(run.result()).rejects.toMatchObject({
      code: "awaiting_input",
      kind: "approval",
      requestId: "req_1",
    });
  });
});
