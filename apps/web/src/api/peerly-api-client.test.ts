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
});
