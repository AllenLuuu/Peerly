import { randomUUID } from "node:crypto";

import type { AgentRuntime, RuntimeAgentDefinition } from "@peerly/agent-protocol";

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
    let conversationId = newConversationId();
    terminal.write("Commands: /new starts a new conversation, /exit quits.\n");

    while (!exitRequested) {
      const content = await terminal.read("You> ");
      if (content === undefined || exitRequested || content.trim() === "/exit") break;
      if (content.trim() === "/new") {
        conversationId = newConversationId();
        terminal.write("Started a new conversation.\n");
        continue;
      }
      if (content.trim().length === 0) continue;

      const controller = new AbortController();
      activeController = controller;
      let thinkingStarted = false;
      try {
        for await (const event of runtime.deliverMessage(
          {
            deliveryId: `cli-delivery-${randomUUID()}`,
            agentId: agent.id,
            conversation: { id: conversationId, type: "direct" },
            messages: [
              {
                id: `cli-message-${randomUUID()}`,
                sender: { id: "runtime-cli-user", type: "human", name: "You" },
                createdAt: new Date().toISOString(),
                content: { type: "text", text: content },
              },
            ],
          },
          { signal: controller.signal },
        )) {
          if (event.type === "thinking_delta") {
            if (!thinkingStarted) {
              terminal.write("Thinking> ");
              thinkingStarted = true;
            }
            terminal.write(event.delta);
          } else if (event.type === "reply_published") {
            if (thinkingStarted) terminal.write("\n");
            terminal.write(`${agent.name}> ${event.text}\n`);
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

function newConversationId(): string {
  return `runtime-cli-${randomUUID()}`;
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
