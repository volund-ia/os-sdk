import { describe, expect, it } from "vitest";

import {
  errorFromApiResponse,
  VolundAuthError,
  VolundError,
  VolundForbiddenError,
  VolundNotFoundError,
  VolundRunBusyError,
} from "../src/errors";

/**
 * Testa o mapeamento direto `errorFromApiResponse(status, body)` → subclasse certa
 * (task 3.3). O caminho de transporte (content-type) é coberto em client.test.ts;
 * aqui isolamos a função pura, código a código.
 */
describe("errorFromApiResponse", () => {
  it("missing_api_key → VolundAuthError (401)", () => {
    const err = errorFromApiResponse(401, { error: "missing_api_key", message: "sem chave" });
    expect(err).toBeInstanceOf(VolundAuthError);
    expect(err.code).toBe("missing_api_key");
    expect(err.status).toBe(401);
    expect(err.message).toBe("sem chave");
  });

  it("invalid_api_key → VolundAuthError (401)", () => {
    const err = errorFromApiResponse(401, { error: "invalid_api_key" });
    expect(err).toBeInstanceOf(VolundAuthError);
    expect(err.code).toBe("invalid_api_key");
    expect(err.status).toBe(401);
  });

  it("forbidden → VolundForbiddenError (403)", () => {
    const err = errorFromApiResponse(403, { error: "forbidden" });
    expect(err).toBeInstanceOf(VolundForbiddenError);
    expect(err.code).toBe("forbidden");
    expect(err.status).toBe(403);
  });

  it("agent_not_found → VolundNotFoundError (404)", () => {
    const err = errorFromApiResponse(404, { error: "agent_not_found" });
    expect(err).toBeInstanceOf(VolundNotFoundError);
    expect(err.code).toBe("agent_not_found");
    expect(err.status).toBe(404);
  });

  it("run_not_found → VolundNotFoundError (404)", () => {
    const err = errorFromApiResponse(404, { error: "run_not_found" });
    expect(err).toBeInstanceOf(VolundNotFoundError);
    expect(err.code).toBe("run_not_found");
    expect(err.status).toBe(404);
  });

  it("run_busy → VolundRunBusyError (409)", () => {
    const err = errorFromApiResponse(409, { error: "run_busy" });
    expect(err).toBeInstanceOf(VolundRunBusyError);
    expect(err.code).toBe("run_busy");
    expect(err.status).toBe(409);
  });

  it("internal_error → VolundError genérico, preservando o status 5xx", () => {
    const err = errorFromApiResponse(500, { error: "internal_error", message: "boom" });
    expect(err).toBeInstanceOf(VolundError);
    // Não é nenhuma das subclasses específicas.
    expect(err).not.toBeInstanceOf(VolundAuthError);
    expect(err).not.toBeInstanceOf(VolundNotFoundError);
    expect(err.code).toBe("internal_error");
    expect(err.status).toBe(500);
    expect(err.message).toBe("boom");
  });

  it("código desconhecido → VolundError genérico com o status original", () => {
    const err = errorFromApiResponse(503, { error: "service_unavailable" } as { error: string });
    expect(err).toBeInstanceOf(VolundError);
    expect(err.code).toBe("service_unavailable");
    expect(err.status).toBe(503);
  });

  it("sem campo error → assume internal_error", () => {
    const err = errorFromApiResponse(500, {});
    expect(err.code).toBe("internal_error");
    expect(err.status).toBe(500);
  });

  it("sem message → sintetiza uma mensagem com o status", () => {
    const err = errorFromApiResponse(500, { error: "internal_error" });
    expect(err.message).toContain("500");
  });
});
