import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliError, EXIT } from "../src/exit-codes.js";
import { vapiFetch } from "../src/http.js";

describe("vapiFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends bearer auth and returns parsed JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "a1" }]), { status: 200 }),
    );
    const data = await vapiFetch<{ id: string }[]>("GET", "/assistant", {
      apiKey: "secret",
      baseUrl: "https://api.example.test",
    });
    expect(data).toEqual([{ id: "a1" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/assistant");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer secret",
    });
  });

  it("forwards query params", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await vapiFetch("GET", "/assistant", {
      apiKey: "k",
      baseUrl: "https://api.example.test",
      query: { limit: 5, createdAtGt: "2026-01-01" },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.example.test/assistant?limit=5&createdAtGt=2026-01-01",
    );
  });

  it("serializes body and sets content-type on POST", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "a1" }), { status: 201 }),
    );
    await vapiFetch("POST", "/assistant", {
      apiKey: "k",
      baseUrl: "https://api.example.test",
      body: { name: "hi" },
    });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"name":"hi"}');
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("maps 401 → AUTH exit code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"bad key"}', { status: 401 }),
    );
    await expect(
      vapiFetch("GET", "/assistant", { apiKey: "k", baseUrl: "https://x.test" }),
    ).rejects.toMatchObject({ code: EXIT.AUTH });
  });

  it("maps 404 → NOT_FOUND", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const err = await vapiFetch("GET", "/assistant/x", {
      apiKey: "k",
      baseUrl: "https://x.test",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe(EXIT.NOT_FOUND);
  });

  it("retries once on 500 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const data = await vapiFetch("GET", "/assistant", {
      apiKey: "k",
      baseUrl: "https://x.test",
    });
    expect(data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when retry:false", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(
      vapiFetch("GET", "/assistant", {
        apiKey: "k",
        baseUrl: "https://x.test",
        retry: false,
      }),
    ).rejects.toMatchObject({ code: EXIT.RETRYABLE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
