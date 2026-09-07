import { join } from "node:path";

import { BACKGROUND_CONTEXT, type Session as PiSession } from "@earendil-works/pi-agent-core";
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from "@earendil-works/pi-session-backend-sqlite-node";
import type { AgentSession } from "@peerly/agent-protocol";

import { agentSessionsDirectory } from "./agent-paths.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";

export class PiSessionStore {
  private readonly repositories = new Map<string, SqliteSessionRepo>();
  private closePromise: Promise<void> | undefined;

  constructor(private readonly dataDirectory: string) {}

  async create(agentId: string): Promise<AgentSession> {
    const session = await this.getRepository(agentId).create({}, BACKGROUND_CONTEXT);
    const publicSession = toAgentSession(agentId, session.metadata);
    await session.close(BACKGROUND_CONTEXT);
    return publicSession;
  }

  async list(agentId: string): Promise<AgentSession[]> {
    const metadata = await this.getRepository(agentId).list(undefined, BACKGROUND_CONTEXT);
    return metadata.map((session) => toAgentSession(agentId, session));
  }

  async delete(agentId: string, sessionId: string): Promise<void> {
    const repository = this.getRepository(agentId);
    const metadata = await this.findSession(repository, sessionId);
    await repository.delete(metadata, BACKGROUND_CONTEXT);
  }

  async open(agentId: string, sessionId: string): Promise<PiSession> {
    const repository = this.getRepository(agentId);
    const metadata = await this.findSession(repository, sessionId);
    return repository.open(metadata, BACKGROUND_CONTEXT);
  }

  close(): Promise<void> {
    this.closePromise ??= Promise.all(
      [...this.repositories.values()].map((repository) => repository.close(BACKGROUND_CONTEXT)),
    ).then(() => undefined);
    return this.closePromise;
  }

  private getRepository(agentId: string): SqliteSessionRepo {
    let repository = this.repositories.get(agentId);
    if (!repository) {
      const directory = agentSessionsDirectory(this.dataDirectory, agentId);
      repository = new SqliteSessionRepo({
        directory,
        databasePath: join(directory, "sessions.sqlite"),
        databaseFactory: createNodeSqliteFactory(),
      });
      this.repositories.set(agentId, repository);
    }
    return repository;
  }

  private async findSession(
    repository: SqliteSessionRepo,
    sessionId: string,
  ): Promise<Awaited<ReturnType<SqliteSessionRepo["list"]>>[number]> {
    const metadata = (await repository.list(undefined, BACKGROUND_CONTEXT)).find(
      (session) => session.id === sessionId,
    );
    if (!metadata) {
      throw new AgentRuntimeOperationError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} was not found`,
      );
    }
    return metadata;
  }
}

function toAgentSession(
  agentId: string,
  metadata: { id: string; createdAt: number },
): AgentSession {
  return {
    id: metadata.id,
    agentId,
    createdAt: new Date(metadata.createdAt).toISOString(),
  };
}
