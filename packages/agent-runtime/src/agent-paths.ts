import { join } from "node:path";

export function agentDirectory(dataDirectory: string, agentId: string): string {
  return join(dataDirectory, "agents", agentId);
}

export function agentDefinitionPath(dataDirectory: string, agentId: string): string {
  return join(agentDirectory(dataDirectory, agentId), "definition.json");
}

export function agentSessionsDirectory(dataDirectory: string, agentId: string): string {
  return join(agentDirectory(dataDirectory, agentId), "sessions");
}

export function agentConversationIndexPath(dataDirectory: string, agentId: string): string {
  return join(agentSessionsDirectory(dataDirectory, agentId), "conversations.json");
}
