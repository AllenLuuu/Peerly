import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runtimeAgentDefinitionSchema, type RuntimeAgentDefinition } from "@peerly/agent-protocol";
import { z } from "zod";

import type { AgentDefinitionRepository } from "./agent-definition-repository.js";

const storedAgentDefinitionSchema = runtimeAgentDefinitionSchema.extend({
  deletedAt: z.string().datetime({ offset: true }).optional(),
});

type StoredAgentDefinition = z.infer<typeof storedAgentDefinitionSchema>;

export class FileAgentDefinitionRepository implements AgentDefinitionRepository {
  private readonly definitionsDirectory: string;

  constructor(dataDirectory: string) {
    this.definitionsDirectory = join(dataDirectory, "definitions");
  }

  async initialize(): Promise<void> {
    await mkdir(this.definitionsDirectory, { recursive: true });
  }

  async exists(id: string): Promise<boolean> {
    return Boolean(await this.readStored(id));
  }

  async findById(id: string): Promise<RuntimeAgentDefinition | undefined> {
    const stored = await this.readStored(id);
    if (!stored || stored.deletedAt) {
      return undefined;
    }
    return this.toPublic(stored);
  }

  async list(): Promise<RuntimeAgentDefinition[]> {
    const fileNames = (await readdir(this.definitionsDirectory)).filter((name) =>
      name.endsWith(".json"),
    );
    const records = await Promise.all(
      fileNames.map((fileName) => this.readStored(fileName.slice(0, -".json".length))),
    );
    return records
      .filter((record): record is StoredAgentDefinition => Boolean(record && !record.deletedAt))
      .map((record) => this.toPublic(record));
  }

  async create(agent: RuntimeAgentDefinition): Promise<void> {
    await this.writeStored(agent);
  }

  async update(agent: RuntimeAgentDefinition): Promise<void> {
    await this.writeStored(agent);
  }

  async softDelete(id: string, deletedAt: string): Promise<void> {
    const current = await this.readStored(id);
    if (!current) {
      return;
    }
    await this.writeStored({
      ...current,
      enabled: false,
      updatedAt: deletedAt,
      deletedAt,
    });
  }

  private filePath(id: string): string {
    return join(this.definitionsDirectory, `${id}.json`);
  }

  private async readStored(id: string): Promise<StoredAgentDefinition | undefined> {
    try {
      const source = await readFile(this.filePath(id), "utf8");
      return storedAgentDefinitionSchema.parse(JSON.parse(source));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async writeStored(agent: StoredAgentDefinition): Promise<void> {
    const destination = this.filePath(agent.id);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const contents = `${JSON.stringify(agent, undefined, 2)}\n`;

    try {
      await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private toPublic(stored: StoredAgentDefinition): RuntimeAgentDefinition {
    return runtimeAgentDefinitionSchema.parse({
      id: stored.id,
      name: stored.name,
      instructions: stored.instructions,
      model: stored.model,
      enabled: stored.enabled,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
