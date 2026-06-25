import { describe, expect, it, vi } from "vitest";

import { postStream, type HttpConfig, type StreamRequestBody } from "../src/http";
import { VolundError, VolundRunBusyError } from "../src/errors";

// --- helpers -------------------------------------------------------------

function sseResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"type":"run_finished","status":"completed","output":"ok","usage":null}\n\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetch que rejeita com AbortError assim que o signal abortar (simula hang). */
const hangingFetch = (async (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError"))
    );
  })) as typeof fetch;

const BODY: StreamRequestBody = { input: "x" };

function baseCfg(fetchImpl: typeof fetch, over: Partial<HttpConfig> = {}): HttpConfig {
  return {
    apiKey: "k",
    baseUrl: "https://api.test",
    fetch: fetchImpl,
    // sleep instantâneo: retries não atrasam a suíte.
    sleep: () => Promise.resolve(),
    ...over,
  };
}

// --- timeout -------------------------------------------------------------

describe("postStream — timeout", () => {
  it("aborta com code 'timeout' quando a resposta não chega a tempo", async () => {
    const cfg = baseCfg(hangingFetch, { timeoutMs: 20, maxRetries: 0 });
    await expect(postStream(cfg, "/p", BODY)).rejects.toMatchObject({ code: "timeout" });
  });

  it("desarma o timeout assim que a resposta chega (não mata o stream)", async () => {
    // timeout curtíssimo, mas a resposta chega na hora: deve passar mesmo assim,
    // e o stream segue legível depois do timeoutMs.
    const cfg = baseCfg((async () => sseResponse()) as typeof fetch, { timeoutMs: 5, maxRetries: 0 });
    const res = await postStream(cfg, "/p", BODY);
    await new Promise((r) => setTimeout(r, 20)); // passou do timeoutMs
    expect(res.body).not.toBeNull(); // stream NÃO foi abortado pelo timer
  });
});

// --- retry ---------------------------------------------------------------

describe("postStream — retry", () => {
  it("repete em erro de rede e sucede na tentativa seguinte", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n < 3) throw new TypeError("conexão recusada");
      return sseResponse();
    }) as typeof fetch;
    const sleep = vi.fn(() => Promise.resolve());
    const cfg = baseCfg(fetchImpl, { maxRetries: 2, sleep });

    const res = await postStream(cfg, "/p", BODY);
    expect(res.ok).toBe(true);
    expect(n).toBe(3); // 1 + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("repete em 5xx e sucede depois", async () => {
    let n = 0;
    const fetchImpl = (async () => (++n < 2 ? jsonError(503, "internal_error") : sseResponse())) as typeof fetch;
    const cfg = baseCfg(fetchImpl, { maxRetries: 2 });
    const res = await postStream(cfg, "/p", BODY);
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("NÃO repete em 4xx (determinístico) — falha na 1ª", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return jsonError(409, "run_busy");
    }) as typeof fetch;
    const cfg = baseCfg(fetchImpl, { maxRetries: 3 });
    await expect(postStream(cfg, "/p", BODY)).rejects.toBeInstanceOf(VolundRunBusyError);
    expect(n).toBe(1);
  });

  it("maxRetries:0 desliga o retry", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      throw new TypeError("offline");
    }) as typeof fetch;
    const cfg = baseCfg(fetchImpl, { maxRetries: 0 });
    await expect(postStream(cfg, "/p", BODY)).rejects.toMatchObject({ code: "network_error" });
    expect(n).toBe(1);
  });

  it("esgota os retries e lança o último erro (404 não retentável encerra antes)", async () => {
    // 5xx sempre: esgota e lança internal_error.
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return jsonError(500, "internal_error");
    }) as typeof fetch;
    const cfg = baseCfg(fetchImpl, { maxRetries: 2 });
    await expect(postStream(cfg, "/p", BODY)).rejects.toMatchObject({ code: "internal_error" });
    expect(n).toBe(3); // 1 + 2 retries
  });
});

// --- cancelamento --------------------------------------------------------

describe("postStream — cancelamento", () => {
  it("não retenta quando o usuário já cancelou", async () => {
    const ac = new AbortController();
    ac.abort();
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return sseResponse();
    }) as typeof fetch;
    const cfg = baseCfg(fetchImpl, { maxRetries: 3 });
    await expect(postStream(cfg, "/p", BODY, ac.signal)).rejects.toBeInstanceOf(VolundError);
    expect(n).toBe(0); // nem chega a chamar fetch
  });

  it("cancel durante o voo não vira retry", async () => {
    const ac = new AbortController();
    const fetchImpl = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        setTimeout(() => ac.abort(), 5);
      })) as typeof fetch;
    const cfg = baseCfg(fetchImpl, { maxRetries: 3, timeoutMs: 0 });
    await expect(postStream(cfg, "/p", BODY, ac.signal)).rejects.toMatchObject({
      code: "network_error",
    });
  });
});
