import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api,
  type AuthContext,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AgentModel, AgentRuntime } from "@peerly/agent-protocol";

import { createAgentRuntime } from "./create-agent-runtime.js";
import { AgentRuntimeOperationError } from "./agent-runtime-operation-error.js";

const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";

export interface CreateAgentRuntimeFromEnvironmentOptions {
  env?: Readonly<Record<string, string | undefined>>;
}

export async function createAgentRuntimeFromEnvironment(
  options: CreateAgentRuntimeFromEnvironmentOptions = {},
): Promise<AgentRuntime> {
  const env = options.env ?? process.env;
  const provider = requiredSetting(env, "PEERLY_MODEL_PROVIDER");
  const modelId = requiredSetting(env, "PEERLY_MODEL_ID");
  const dataDirectory = setting(env, "PEERLY_AGENT_DATA_DIR") ?? "data/agent-runtime";
  const authContext = environmentAuthContext(env);
  const defaultModel = { provider, modelId };
  const models =
    provider === OPENAI_COMPATIBLE_PROVIDER
      ? openAICompatibleModels(env, defaultModel, authContext)
      : builtinModels({ authContext });

  if (!models.getModel(provider, modelId)) {
    throw new AgentRuntimeOperationError(
      "MODEL_NOT_FOUND",
      `Configured model ${provider}/${modelId} was not found`,
      { provider, modelId },
    );
  }

  return createAgentRuntime({ dataDirectory, defaultModel, models });
}

function openAICompatibleModels(
  env: Readonly<Record<string, string | undefined>>,
  defaultModel: AgentModel,
  authContext: AuthContext,
): Models {
  const baseUrl = requiredSetting(env, "OPENAI_BASE_URL").replace(/\/$/, "");
  requiredSetting(env, "OPENAI_API_KEY");
  const mode = setting(env, "PEERLY_OPENAI_API") ?? "chat-completions";
  if (mode !== "chat-completions" && mode !== "responses") {
    throw new AgentRuntimeOperationError(
      "VALIDATION_ERROR",
      "PEERLY_OPENAI_API must be either chat-completions or responses",
    );
  }

  const api = mode === "responses" ? "openai-responses" : "openai-completions";
  const model: Model<Api> = {
    id: defaultModel.modelId,
    name: defaultModel.modelId,
    api,
    provider: defaultModel.provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
  const models = createModels({ authContext });
  models.setProvider(
    createProvider({
      id: defaultModel.provider,
      name: "OpenAI-compatible",
      baseUrl,
      auth: {
        apiKey: envApiKeyAuth("OpenAI-compatible API key", ["OPENAI_API_KEY"]),
      },
      models: [model],
      api: mode === "responses" ? openAIResponsesApi() : openAICompletionsApi(),
    }),
  );
  return models;
}

function environmentAuthContext(env: Readonly<Record<string, string | undefined>>): AuthContext {
  return {
    env: async (name) => setting(env, name),
    fileExists: async () => false,
  };
}

function requiredSetting(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = setting(env, name);
  if (!value) {
    throw new AgentRuntimeOperationError(
      "VALIDATION_ERROR",
      `Missing required environment setting ${name}`,
    );
  }
  return value;
}

function setting(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}
