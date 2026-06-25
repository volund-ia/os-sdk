import { describe, expect, it } from "vitest";

import { VolundOS } from "../src/client";
import {
  VolundAuthError,
  VolundError,
  VolundForbiddenError,
  VolundNotFoundError,
  VolundRunBusyError,
  VolundRunFailedError,
  VolundAwaitingInputError,
} from "../src/errors";
import type { VolundEvent } from "../src/protocol/events";

// --- helpers -------------------------------------------------------------

const frame = (e: VolundEvent, id?: number) =>
  `${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(e)}\n\n`;

/** Response SSE a partir de um wire de texto. */
function sseResponse(wire: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(wire));
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function jsonError(status: number, payload: { error: string; message?: string }): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  url: string;
  init: RequestInit;
}

/** fetch falso que registra chamadas e devolve o que o handler mandar. */
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const i = init ?? {};
    calls.push({ url, init: i });
    return handler(url, i);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const RUN_WIRE =
  frame({ type: "run_started", protocol: "v1", run_id: "t_1", agent_id: "agt_1" }, 0) +
  frame({ type: "assistant_text_delta", delta: "Oi" }, 1) +
  frame({ type: "assistant_text_delta", delta: " mundo" }, 2) +
  frame(
    {
      type: "run_finished",
      status: "completed",
      output: "Oi mundo",
      usage: { input_tokens: 5, output_tokens: 2 },
    },
    3
  );

// --- config / construtor -------------------------------------------------

describe("VolundOS (config)", () => {
  it("exige apiKey", () => {
    // @ts-expect-error — testando guarda de runtime
    expect(() => new VolundOS({})).toThrowError(VolundError);
  });
});

// --- agents.run ----------------------------------------------------------

describe("agents.run", () => {
  it("faz POST no endpoint certo com auth e body corretos", async () => {
    const { fetch, calls } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k_test", baseUrl: "https://api.test", fetch });

    await volund.agents.run({ agentId: "agt_1", input: "olá" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.test/api/v1/agents/agt_1/stream");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k_test");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ input: "olá" });
  });

  it("inclui files no body quando informado", async () => {
    const { fetch, calls } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", fetch });

    await volund.agents.run({
      agentId: "a",
      input: "x",
      files: [{ url: "https://f/doc.pdf" }],
    });

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      input: "x",
      files: [{ url: "https://f/doc.pdf" }],
    });
  });

  it("strema os eventos na ordem", async () => {
    const { fetch } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", fetch });

    const run = await volund.agents.run({ agentId: "a", input: "x" });
    const types: string[] = [];
    for await (const ev of run.stream()) types.push(ev.type);

    expect(types).toEqual([
      "run_started",
      "assistant_text_delta",
      "assistant_text_delta",
      "run_finished",
    ]);
  });

  it("preenche run.id a partir do run_started (run novo)", async () => {
    const { fetch } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    expect(run.id).toBe(""); // ainda não consumido
    await run.result();
    expect(run.id).toBe("t_1"); // backfill via run_started
  });

  it("usa a baseUrl default quando não informada", async () => {
    const { fetch, calls } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await volund.agents.run({ agentId: "a", input: "x" });
    expect(calls[0]!.url).toBe("https://os.volund.com.br/api/v1/agents/a/stream");
  });

  it("envia defaultHeaders sem deixar sobrescrever os obrigatórios", async () => {
    const { fetch, calls } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({
      apiKey: "k",
      fetch,
      defaultHeaders: {
        "x-vercel-protection-bypass": "secret",
        Authorization: "Bearer HACK", // tentativa de override — deve ser ignorada
      },
    });
    await volund.agents.run({ agentId: "a", input: "x" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-vercel-protection-bypass"]).toBe("secret");
    expect(headers.Authorization).toBe("Bearer k"); // obrigatório venceu
  });

  it("rejeita execution local (V1)", async () => {
    const { fetch } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(
      volund.agents.run({ agentId: "a", input: "x", execution: { local: { cwd: "/tmp" } } })
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});

// --- agents.continue -----------------------------------------------------

describe("agents.continue", () => {
  it("faz POST em /runs/{id}/stream e devolve um Run com o id", async () => {
    const { fetch, calls } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", baseUrl: "https://api.test", fetch });

    const run = await volund.agents.continue({ runId: "t_42", input: "e aí?" });

    expect(calls[0]!.url).toBe("https://api.test/api/v1/runs/t_42/stream");
    expect(run.id).toBe("t_42");
  });
});

// --- run.result() --------------------------------------------------------

describe("run.result()", () => {
  it("devolve output + usage no caminho feliz", async () => {
    const { fetch } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    await expect(run.result()).resolves.toEqual({
      output: "Oi mundo",
      usage: { input_tokens: 5, output_tokens: 2 },
    });
  });

  it("lança VolundRunFailedError quando o run falha", async () => {
    const wire =
      frame({ type: "run_started", protocol: "v1", run_id: "t", agent_id: "a" }) +
      frame({ type: "run_finished", status: "failed", output: null, usage: null, error: "error_max_turns" });
    const { fetch } = mockFetch(() => sseResponse(wire));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    await expect(run.result()).rejects.toBeInstanceOf(VolundRunFailedError);
  });

  it("lança VolundAwaitingInputError quando pausa p/ vault", async () => {
    const wire = frame({ type: "awaiting_input", request_id: "req_7", kind: "vault" });
    const { fetch } = mockFetch(() => sseResponse(wire));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    await expect(run.result()).rejects.toMatchObject({
      code: "awaiting_input",
      requestId: "req_7",
      kind: "vault",
    });
  });
});

// --- consumo único -------------------------------------------------------

describe("Run consumo único", () => {
  it("lança ao consumir o stream duas vezes", async () => {
    const { fetch } = mockFetch(() => sseResponse(RUN_WIRE));
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    await run.result(); // consome
    await expect(async () => {
      for await (const _ of run.stream()) void _;
    }).rejects.toMatchObject({ code: "stream_error" });
  });
});

// --- cancelamento --------------------------------------------------------

describe("run.cancel()", () => {
  it("aborta o signal passado ao fetch", async () => {
    let captured: AbortSignal | undefined;
    const { fetch } = mockFetch((_url, init) => {
      captured = init.signal ?? undefined;
      return sseResponse(RUN_WIRE);
    });
    const volund = new VolundOS({ apiKey: "k", fetch });
    const run = await volund.agents.run({ agentId: "a", input: "x" });

    expect(captured?.aborted).toBe(false);
    run.cancel();
    expect(captured?.aborted).toBe(true);
  });
});

// --- fiação de timeout/retry (config pública → transporte) ---------------

describe("VolundOS timeout/retry", () => {
  it("propaga timeoutMs: aborta com code 'timeout' se a resposta não chega", async () => {
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const volund = new VolundOS({ apiKey: "k", fetch: fetchImpl, timeoutMs: 20, maxRetries: 0 });
    await expect(volund.agents.run({ agentId: "a", input: "x" })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("propaga maxRetries: repete em 5xx e sucede", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n < 2) return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "content-type": "application/json" } });
      return sseResponse(RUN_WIRE);
    }) as typeof fetch;
    const volund = new VolundOS({ apiKey: "k", fetch: fetchImpl, maxRetries: 1 });
    const run = await volund.agents.run({ agentId: "a", input: "x" });
    await expect(run.result()).resolves.toMatchObject({ output: "Oi mundo" });
    expect(n).toBe(2);
  });
});

// --- mapeamento de erros -------------------------------------------------

describe("mapeamento de erros pré-stream", () => {
  it("401 → VolundAuthError", async () => {
    const { fetch } = mockFetch(() => jsonError(401, { error: "invalid_api_key", message: "chave inválida" }));
    const volund = new VolundOS({ apiKey: "bad", fetch });
    await expect(volund.agents.run({ agentId: "a", input: "x" })).rejects.toBeInstanceOf(VolundAuthError);
  });

  it("403 → VolundForbiddenError", async () => {
    const { fetch } = mockFetch(() => jsonError(403, { error: "forbidden" }));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(volund.agents.run({ agentId: "a", input: "x" })).rejects.toBeInstanceOf(VolundForbiddenError);
  });

  it("404 → VolundNotFoundError", async () => {
    const { fetch } = mockFetch(() => jsonError(404, { error: "agent_not_found" }));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(volund.agents.run({ agentId: "nope", input: "x" })).rejects.toBeInstanceOf(VolundNotFoundError);
  });

  it("409 → VolundRunBusyError (continuação)", async () => {
    const { fetch } = mockFetch(() => jsonError(409, { error: "run_busy" }));
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(volund.agents.continue({ runId: "t", input: "x" })).rejects.toBeInstanceOf(VolundRunBusyError);
  });

  it("200 mas content-type errado → tratado como erro (não tenta parsear SSE)", async () => {
    const { fetch } = mockFetch(
      () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    const volund = new VolundOS({ apiKey: "k", fetch });
    await expect(volund.agents.run({ agentId: "a", input: "x" })).rejects.toBeInstanceOf(VolundError);
  });
});
