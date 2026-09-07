import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";

import type { RuntimeCliTerminal } from "./cli.js";

export class NodeTerminal implements RuntimeCliTerminal {
  private readonly readline: Interface;
  private readonly output: Writable;
  private closed = false;
  private activeReadController: AbortController | undefined;

  constructor(options: { input?: Readable; output?: Writable } = {}) {
    this.output = options.output ?? stdout;
    this.readline = createInterface({
      input: options.input ?? stdin,
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
    this.readline.on("SIGINT", handler);
    return () => this.readline.off("SIGINT", handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.activeReadController?.abort();
    this.readline.close();
  }
}
