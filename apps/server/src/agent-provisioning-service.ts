import type { AgentRuntime } from "@peerly/agent-protocol";
import type { AgentPrincipal, CreateAgentPrincipalInput } from "@peerly/contracts";

import type { PeerlyService } from "./peerly-service.js";

export class AgentProvisioningService {
  constructor(
    private readonly peerly: PeerlyService,
    private readonly runtime: AgentRuntime,
  ) {}

  async create(input: CreateAgentPrincipalInput, actorId?: string): Promise<AgentPrincipal> {
    this.peerly.requireAdministrator(actorId);
    const definition = await this.runtime.createAgent({
      name: input.displayName,
      instructions: input.instructions,
    });
    try {
      return await this.peerly.registerAgent(input, definition, actorId);
    } catch (error) {
      await this.runtime.deleteAgent(definition.id).catch(() => undefined);
      throw error;
    }
  }
}
