import type { AgentRuntimeErrorCode } from "@peerly/agent-protocol";

export class AgentRuntimeOperationError extends Error {
  constructor(
    public readonly code: AgentRuntimeErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentRuntimeOperationError";
  }
}
