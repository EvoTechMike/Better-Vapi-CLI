import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleError, main } from "../src/cli.js";
import { CliError } from "../src/exit-codes.js";

describe("CLI wiring", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const stdoutCalls: unknown[][] = [];

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stdoutCalls.length = 0;
    vi.spyOn(process.stdout, "write").mockImplementation(((...args: unknown[]) => {
      stdoutCalls.push(args);
      return true;
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit:${code ?? 0}`);
    }) as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function lastStdout(): string {
    return stdoutCalls.length === 0 ? "" : String(stdoutCalls[stdoutCalls.length - 1]![0]);
  }
  function allStdout(): string {
    return stdoutCalls.map((c) => String(c[0])).join("");
  }

  async function run(argv: string[]): Promise<void> {
    try {
      await main(["node", "bvapi", ...argv]);
    } catch (err) {
      if (err instanceof CliError) handleError(err);
      // Otherwise re-throw — emit's direct process.exit() surfaces as
      // the synthetic __exit:N from our mock and we want it untouched.
      throw err;
    }
  }

  it("assistant list --dry-run prints planned GET", async () => {
    await run(["assistant", "list", "--limit", "3", "--dry-run", "--json"]);
    expect(JSON.parse(lastStdout())).toEqual({
      method: "GET",
      url: "https://api.vapi.ai/assistant?limit=3",
      body: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("assistant get hits the right URL with bearer auth", async () => {
    process.env.VAPI_API_KEY = "test-key";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "abc", name: "x" }), { status: 200 }),
    );
    await run(["assistant", "get", "abc", "--json"]);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.vapi.ai/assistant/abc");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(lastStdout())).toEqual({ id: "abc", name: "x" });
    delete process.env.VAPI_API_KEY;
  });

  it("squad delete without --force exits 2", async () => {
    process.env.VAPI_API_KEY = "test-key";
    await expect(run(["squad", "delete", "x"])).rejects.toThrow("__exit:2");
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.VAPI_API_KEY;
  });

  it("squad delete --dry-run skips confirmation", async () => {
    await run(["squad", "delete", "abc", "--dry-run", "--json"]);
    expect(JSON.parse(lastStdout())).toEqual({
      method: "DELETE",
      url: "https://api.vapi.ai/squad/abc",
      body: null,
    });
  });

  it("empty list exits 3", async () => {
    process.env.VAPI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await expect(run(["assistant", "list", "--json"])).rejects.toThrow("__exit:3");
    delete process.env.VAPI_API_KEY;
  });

  it("--out writes file and prints path", async () => {
    process.env.VAPI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "a" }]), { status: 200 }),
    );
    const out = `/tmp/vapi-test-${Date.now()}.json`;
    await run(["assistant", "list", "--out", out, "--json"]);
    const printed = JSON.parse(allStdout()) as { path: string };
    expect(printed.path).toBe(out);
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toEqual([{ id: "a" }]);
    fs.unlinkSync(out);
    delete process.env.VAPI_API_KEY;
  });

  it("schema returns the registered command tree", async () => {
    await run(["schema", "--json"]);
    const tree = JSON.parse(lastStdout()) as { subcommands: { name: string }[] };
    const names = tree.subcommands.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "auth",
        "assistant",
        "squad",
        "call",
        "phone-number",
        "schema",
        "exit-codes",
      ]),
    );
  });

  it("call list forwards --assistant-id and --limit as query params", async () => {
    await run([
      "call",
      "list",
      "--assistant-id",
      "a1",
      "--limit",
      "5",
      "--dry-run",
      "--json",
    ]);
    expect(JSON.parse(lastStdout())).toEqual({
      method: "GET",
      url: "https://api.vapi.ai/call?limit=5&assistantId=a1",
      body: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("call list forwards --created-at-ge through the new Ge/Le wiring", async () => {
    await run([
      "call",
      "list",
      "--created-at-ge",
      "2026-04-01T00:00:00Z",
      "--dry-run",
      "--json",
    ]);
    const planned = JSON.parse(lastStdout()) as { url: string };
    expect(planned.url).toContain("createdAtGe=2026-04-01T00%3A00%3A00Z");
  });

  it("call get hits the right URL with bearer auth", async () => {
    process.env.VAPI_API_KEY = "test-key";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "c1", status: "ended" }), { status: 200 }),
    );
    await run(["call", "get", "c1", "--json"]);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.vapi.ai/call/c1");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(lastStdout())).toEqual({ id: "c1", status: "ended" });
    delete process.env.VAPI_API_KEY;
  });

  it("call delete without --force exits 2", async () => {
    process.env.VAPI_API_KEY = "test-key";
    await expect(run(["call", "delete", "c1"])).rejects.toThrow("__exit:2");
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.VAPI_API_KEY;
  });

  it("phone-number get hits /phone-number/{id}", async () => {
    process.env.VAPI_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "p1", number: "+15551234" }), { status: 200 }),
    );
    await run(["phone-number", "get", "p1", "--json"]);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.vapi.ai/phone-number/p1");
    expect(JSON.parse(lastStdout())).toMatchObject({ id: "p1" });
    delete process.env.VAPI_API_KEY;
  });

  it("schema narrows to a subcommand", async () => {
    await run(["schema", "assistant", "get", "--json"]);
    const node = JSON.parse(lastStdout()) as {
      name: string;
      arguments: { name: string }[];
    };
    expect(node.name).toBe("get");
    expect(node.arguments[0]?.name).toBe("id");
  });

});
