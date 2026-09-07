import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { NodeTerminal } from "./node-terminal.js";

describe("NodeTerminal", () => {
  it("settles a pending read when the terminal is closed", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const terminal = new NodeTerminal({ input, output });

    const pendingRead = terminal.read("You> ");
    terminal.close();

    await expect(pendingRead).resolves.toBeUndefined();
  });
});
