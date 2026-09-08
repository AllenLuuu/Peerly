import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";

import type { RuntimeCliTerminal } from "./cli.js";

export class NodeTerminal implements RuntimeCliTerminal {
  private readonly input: Readable;
  private readonly readline: Interface;
  private readonly output: Writable;
  private closed = false;
  private activeReadController: AbortController | undefined;

  constructor(options: { input?: Readable; output?: Writable } = {}) {
    this.input = options.input ?? stdin;
    this.output = options.output ?? stdout;
    this.readline = createInterface({
      input: this.input,
      output: this.output,
      terminal: true,
    });
  }

  async read(prompt: string): Promise<string | undefined> {
    if (this.closed) return undefined;
    const controller = new AbortController();
    this.activeReadController = controller;
    try {
      return await this.readline.question(prompt, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) return undefined;
      throw error;
    } finally {
      if (this.activeReadController === controller) this.activeReadController = undefined;
    }
  }

  write(content: string): void {
    this.output.write(content);
  }

  onInterrupt(handler: () => void): () => void {
    let handling = false;
    const invokeOnce = () => {
      if (handling) return;
      handling = true;
      queueMicrotask(() => {
        handling = false;
      });
      handler();
    };
    const handlePipedInput = (chunk: unknown) => {
      if (String(chunk).includes("\u0003")) invokeOnce();
    };

    this.readline.on("SIGINT", invokeOnce);
    if (!isTerminalInput(this.input)) this.input.on("data", handlePipedInput);
    return () => {
      this.readline.off("SIGINT", invokeOnce);
      this.input.off("data", handlePipedInput);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.activeReadController?.abort();
    this.readline.close();
    this.input.pause();
    unrefInput(this.input);
  }
}

function isTerminalInput(input: Readable): boolean {
  return "isTTY" in input && input.isTTY === true;
}

function unrefInput(input: Readable): void {
  const unref = Reflect.get(input, "unref");
  if (typeof unref === "function") unref.call(input);
}
