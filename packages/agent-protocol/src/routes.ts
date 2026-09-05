const encodeId = (id: string): string => encodeURIComponent(id);

export const runtimeRoutes = {
  agents: "/v1/agents",
  agent: (agentId: string) => `/v1/agents/${encodeId(agentId)}`,
  agentRuns: (agentId: string) => `/v1/agents/${encodeId(agentId)}/runs`,
  run: (runId: string) => `/v1/runs/${encodeId(runId)}`,
  runEvents: (runId: string) => `/v1/runs/${encodeId(runId)}/events`,
  cancelRun: (runId: string) => `/v1/runs/${encodeId(runId)}/cancel`,
} as const;
