import { createAgentRuntimeFromEnvironment } from "@peerly/agent-runtime";

import { runRuntimeCli } from "./cli.js";
import { NodeTerminal } from "./node-terminal.js";

const runtime = await createAgentRuntimeFromEnvironment();
await runRuntimeCli({ runtime, terminal: new NodeTerminal() });
