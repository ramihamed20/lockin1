import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest, getApiHealth, refreshCsrfToken } from "./client";

describe("same-origin API client", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("obtains CSRF before an unsafe JSON request", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: "secure-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "accepted" }), { status: 200 }));

    await apiRequest("/auth/password-reset", { method: "POST", body: { email: "a@example.com" } });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/v1/auth/csrf", expect.objectContaining({ credentials: "same-origin" }));
    const secondRequest = vi.mocked(fetch).mock.calls[1];
    expect(secondRequest?.[0]).toBe("/api/v1/auth/password-reset");
    expect((secondRequest?.[1]?.headers as Headers).get("X-CSRFToken")).toBe("secure-token");
  });

  it("maps the stable backend error envelope", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "invalid_credentials", message: "No match", fields: null, request_id: "req-1" } }), { status: 403, headers: { "content-type": "application/json" } }));

    await expect(apiRequest("/auth/session")).rejects.toMatchObject({ status: 403, code: "invalid_credentials", message: "No match", requestId: "req-1" } satisfies Partial<ApiError>);
  });

  it("rejects malformed CSRF contracts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(refreshCsrfToken()).rejects.toThrow(/expected contract/i);
  });

  it("handles cached CSRF and empty successful responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("validates health payloads and preserves abort signals", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", service: "lockin-api" }), { status: 200 }));
    await expect(getApiHealth(controller.signal)).resolves.toEqual({ status: "ok", service: "lockin-api" });
    expect(fetch).toHaveBeenCalledWith("/api/v1/health/live", expect.objectContaining({ signal: controller.signal }));

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: "wrong" }), { status: 200 }));
    await expect(getApiHealth()).rejects.toThrow(/expected contract/i);
  });

  it("uses safe defaults for non-JSON failures and rejected CSRF setup", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(apiRequest("/health/live")).rejects.toMatchObject({ status: 503, code: "request_failed" });

    vi.mocked(fetch).mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(refreshCsrfToken()).rejects.toThrow(/secure browser session/i);
  });
});
