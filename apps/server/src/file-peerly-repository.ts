import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  conversationSchema,
  messageSchema,
  principalSchema,
  type Message,
} from "@peerly/contracts";
import { z } from "zod";

import type { PeerlyRepository, PeerlyState } from "./domain.js";

const peerlyStateSchema = z.strictObject({
  organization: z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  principals: z.array(principalSchema),
  conversations: z.array(conversationSchema),
});

export class FilePeerlyRepository implements PeerlyRepository {
  readonly #statePath: string;
  readonly #messagesDirectory: string;
  #state: PeerlyState;

  private constructor(dataDirectory: string, state: PeerlyState) {
    this.#statePath = join(dataDirectory, "state.json");
    this.#messagesDirectory = join(dataDirectory, "messages");
    this.#state = state;
  }

  static async create(dataDirectory: string): Promise<FilePeerlyRepository> {
    await mkdir(join(dataDirectory, "messages"), { recursive: true });
    const statePath = join(dataDirectory, "state.json");

    let state: PeerlyState;
    try {
      state = peerlyStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      state = {
        organization: { id: "local", name: "Peerly" },
        principals: [],
        conversations: [],
      };
      await writeJsonAtomically(statePath, state);
    }

    return new FilePeerlyRepository(dataDirectory, state);
  }

  readState(): PeerlyState {
    return structuredClone(this.#state);
  }

  async saveState(state: PeerlyState): Promise<void> {
    const validatedState = peerlyStateSchema.parse(state);
    await writeJsonAtomically(this.#statePath, validatedState);
    this.#state = structuredClone(validatedState);
  }

  async readMessages(conversationId: string): Promise<Message[]> {
    try {
      const contents = await readFile(this.#messagePath(conversationId), "utf8");
      return contents
        .split(/\r?\n/u)
        .filter((line) => line.length > 0)
        .map((line) => messageSchema.parse(JSON.parse(line)));
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  async appendMessage(message: Message): Promise<void> {
    const validatedMessage = messageSchema.parse(message);
    await appendFile(
      this.#messagePath(validatedMessage.conversationId),
      `${JSON.stringify(validatedMessage)}\n`,
      "utf8",
    );
  }

  #messagePath(conversationId: string): string {
    return join(this.#messagesDirectory, `${conversationId}.jsonl`);
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
