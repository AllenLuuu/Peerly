import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

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

  it("recognizes Ctrl+C forwarded through piped input", () => {
    const input = new PassThrough();
    const terminal = new NodeTerminal({ input, output: new PassThrough() });
    const handler = vi.fn();
    const removeHandler = terminal.onInterrupt(handler);

    input.write("\u0003");

    expect(handler).toHaveBeenCalledOnce();
    removeHandler();
    terminal.close();
  });

  it("settles a pending piped read when Ctrl+C closes the terminal", async () => {
    const input = new PassThrough();
    const terminal = new NodeTerminal({ input, output: new PassThrough() });
    const removeHandler = terminal.onInterrupt(() => terminal.close());

    const pendingRead = terminal.read("You> ");
    input.write("\u0003");

    await expect(pendingRead).resolves.toBeUndefined();
    removeHandler();
  });
});
