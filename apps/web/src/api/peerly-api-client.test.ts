// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpPeerlyApi } from "./peerly-api-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpPeerlyApi", () => {
  it("后端返回空响应时给出可操作的错误信息", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502 })));

    await expect(new HttpPeerlyApi().getSession()).rejects.toThrow(
      "服务端未返回有效 JSON，请确认 Peerly 后端是否已启动",
    );
  });

  it("无请求体的 Agent 删除不声明 JSON content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new HttpPeerlyApi().deleteAgent("agent principal/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/principals/agents/agent%20principal%2F1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.any(Headers),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("content-type")).toBe(false);
  });

  it("有 JSON 请求体时自动声明 JSON content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          principal: {
            id: "human-1",
            displayName: "Allen",
            createdAt: "2026-09-09T00:00:00.000Z",
            type: "human",
            role: "admin",
            status: "active",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new HttpPeerlyApi().selectSession("human-1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("服务端 500 响应会在错误信息中保留 request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "Internal server error",
              requestId: "req-42",
            },
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(new HttpPeerlyApi().getSession()).rejects.toThrow(
      "Internal server error (request ID: req-42)",
    );
  });
});
