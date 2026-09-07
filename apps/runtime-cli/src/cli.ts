import type { AgentRuntime, AgentSession, RuntimeAgentDefinition } from "@peerly/agent-protocol";

export interface RuntimeCliTerminal {
  read(prompt: string): Promise<string | undefined>;
  write(content: string): void;
  onInterrupt(handler: () => void): () => void;
  close(): void;
}

export interface RunRuntimeCliOptions {
  runtime: AgentRuntime;
  terminal: RuntimeCliTerminal;
}

export async function runRuntimeCli({ runtime, terminal }: RunRuntimeCliOptions): Promise<void> {
  let activeController: AbortController | undefined;
  let exitRequested = false;
  const removeInterruptHandler = terminal.onInterrupt(() => {
    if (activeController) {
      activeController.abort();
    } else {
      exitRequested = true;
      terminal.close();
    }
  });

  try {
    terminal.write("Peerly Agent Runtime CLI\n");
    const agent = await selectAgent(runtime, terminal);
    if (!agent || exitRequested) return;
    let session = await selectSession(runtime, terminal, agent.id);
    if (!session || exitRequested) return;
    terminal.write("Commands: /new starts a new session, /exit quits.\n");

    while (!exitRequested) {
      const content = await terminal.read("You> ");
      if (content === undefined || exitRequested || content.trim() === "/exit") break;
      if (content.trim() === "/new") {
        session = await runtime.createSession({ agentId: agent.id });
        terminal.write(`Started session ${session.id}.\n`);
        continue;
      }
      if (content.trim().length === 0) continue;

      const controller = new AbortController();
      activeController = controller;
      terminal.write(`${agent.name}> `);
      let receivedDelta = false;
      try {
        for await (const event of runtime.sendMessage(
          { agentId: agent.id, sessionId: session.id, content },
          { signal: controller.signal },
        )) {
          if (event.type === "output_delta") {
            receivedDelta = true;
            terminal.write(event.delta);
          } else if (event.type === "run_completed") {
            if (!receivedDelta) terminal.write(event.content);
            terminal.write("\n");
          } else if (event.type === "run_cancelled") {
            terminal.write("\nCancelled.\n");
          } else if (event.type === "run_failed") {
            terminal.write(`\nError [${event.error.code}]: ${event.error.message}\n`);
          }
        }
      } finally {
        activeController = undefined;
      }
    }
  } finally {
    removeInterruptHandler();
    terminal.close();
    await runtime.close();
  }
}

async function selectAgent(
  runtime: AgentRuntime,
  terminal: RuntimeCliTerminal,
): Promise<RuntimeAgentDefinition | undefined> {
  const agents = (await runtime.listAgents()).filter((agent) => agent.enabled);
  if (agents.length === 0) {
    terminal.write("No enabled Agents found. Create the first Agent.\n");
    const idInput = await terminal.read("Agent id [assistant]: ");
    if (idInput === undefined) return undefined;
    const id = withDefault(idInput, "assistant");
    const nameInput = await terminal.read("Agent name [Assistant]: ");
    if (nameInput === undefined) return undefined;
    const name = withDefault(nameInput, "Assistant");
    const instructionsInput = await terminal.read("Instructions [Be a helpful assistant.]: ");
    if (instructionsInput === undefined) return undefined;
    const instructions = withDefault(instructionsInput, "Be a helpful assistant.");
    return runtime.createAgent({ id, name, instructions });
  }

  terminal.write("Agents:\n");
  agents.forEach((agent, index) => terminal.write(`  ${index + 1}. ${agent.name} (${agent.id})\n`));
  const selectionInput = await terminal.read("Select Agent [1]: ");
  if (selectionInput === undefined) return undefined;
  const selection = withDefault(selectionInput, "1");
  return selectNumbered(agents, selection, "Agent");
}

async function selectSession(
  runtime: AgentRuntime,
  terminal: RuntimeCliTerminal,
  agentId: string,
): Promise<AgentSession | undefined> {
  const sessions = await runtime.listSessions(agentId);
  if (sessions.length === 0) return runtime.createSession({ agentId });

  terminal.write("Sessions:\n");
  sessions.forEach((session, index) =>
    terminal.write(`  ${index + 1}. ${session.id} (${session.createdAt})\n`),
  );
  terminal.write(`  ${sessions.length + 1}. New session\n`);
  const selectionInput = await terminal.read("Select session [1]: ");
  if (selectionInput === undefined) return undefined;
  const selection = withDefault(selectionInput, "1");
  const selectedIndex = Number(selection) - 1;
  if (selectedIndex === sessions.length) return runtime.createSession({ agentId });
  return selectNumbered(sessions, selection, "session");
}

function selectNumbered<T>(items: T[], selection: string, label: string): T {
  const selected = items[Number(selection) - 1];
  if (!selected) throw new Error(`Invalid ${label} selection`);
  return selected;
}

function withDefault(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : defaultValue;
}
