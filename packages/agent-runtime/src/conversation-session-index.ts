import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { agentConversationIndexPath } from "./agent-paths.js";
import type { PiSessionStore } from "./pi-session-store.js";

const indexSchema = z.strictObject({
  conversations: z.record(z.string(), z.string().min(1)),
});

type ConversationIndex = z.infer<typeof indexSchema>;

export class ConversationSessionIndex {
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDirectory: string,
    private readonly sessions: PiSessionStore,
  ) {}

  resolve(agentId: string, conversationId: string): Promise<string> {
    return this.#mutate(async () => {
      const path = agentConversationIndexPath(this.dataDirectory, agentId);
      const index = await readIndex(path);
      const existing = index.conversations[conversationId];
      if (existing) return existing;

      const session = await this.sessions.create(agentId);
      index.conversations[conversationId] = session.id;
      await writeJsonAtomically(path, index);
      return session.id;
    });
  }

  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

async function readIndex(path: string): Promise<ConversationIndex> {
  try {
    return indexSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissingFileError(error)) return { conversations: {} };
    throw error;
  }
}

async function writeJsonAtomically(path: string, value: ConversationIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
