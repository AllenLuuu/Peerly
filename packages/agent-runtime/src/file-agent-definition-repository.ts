import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { runtimeAgentDefinitionSchema, type RuntimeAgentDefinition } from "@peerly/agent-protocol";
import { z } from "zod";

import type { AgentDefinitionRepository } from "./agent-definition-repository.js";
import { agentDefinitionPath } from "./agent-paths.js";

const storedAgentDefinitionSchema = runtimeAgentDefinitionSchema.extend({
  deletedAt: z.string().datetime({ offset: true }).optional(),
});

type StoredAgentDefinition = z.infer<typeof storedAgentDefinitionSchema>;

export class FileAgentDefinitionRepository implements AgentDefinitionRepository {
  private readonly agentsDirectory: string;

  constructor(private readonly dataDirectory: string) {
    this.agentsDirectory = join(dataDirectory, "agents");
  }

  async initialize(): Promise<void> {
    await mkdir(this.agentsDirectory, { recursive: true });
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
    const agentDirectories = (await readdir(this.agentsDirectory, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory(),
    );
    const records = await Promise.all(agentDirectories.map((entry) => this.readStored(entry.name)));
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
    return agentDefinitionPath(this.dataDirectory, id);
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
      await mkdir(dirname(destination), { recursive: true });
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
