import cookie from "@fastify/cookie";
import {
  conversationIdSchema,
  createAgentPrincipalInputSchema,
  createDirectConversationInputSchema,
  createGroupConversationInputSchema,
  createHumanInputSchema,
  listMessagesQuerySchema,
  selectDevSessionInputSchema,
  sendMessageInputSchema,
  updateGroupParticipantsInputSchema,
} from "@peerly/contracts";
import type { AgentHost, AgentRuntime } from "@peerly/agent-protocol";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";

import { PeerlyError } from "./errors.js";
import { AgentMessageDispatcher, createPeerlyAgentHost } from "./agent-message-dispatcher.js";
import { AgentProvisioningService } from "./agent-provisioning-service.js";
import { FilePeerlyRepository } from "./file-peerly-repository.js";
import { PeerlyService, type PeerlyServiceOptions } from "./peerly-service.js";
import { attachPeerlyRealtime } from "./realtime.js";

const sessionCookieName = "peerly_session";
const conversationParamsSchema = z.strictObject({
  conversationId: conversationIdSchema,
});
const deliveryParamsSchema = z.strictObject({
  deliveryId: z.string().trim().min(1),
});

export interface CreatePeerlyAppOptions extends PeerlyServiceOptions {
  dataDirectory: string;
  agentRuntimeFactory?: (host: AgentHost) => Promise<AgentRuntime>;
}

export async function createPeerlyApp(options: CreatePeerlyAppOptions): Promise<FastifyInstance> {
  const repository = await FilePeerlyRepository.create(options.dataDirectory);
  const service = new PeerlyService(repository, options);
  const app = Fastify({ logger: false });

  await app.register(cookie);
  const realtime = attachPeerlyRealtime(app, (principalId) =>
    service.getSessionPrincipal(principalId),
  );
  const agentRuntime = options.agentRuntimeFactory
    ? await options.agentRuntimeFactory(createPeerlyAgentHost(service, realtime))
    : undefined;
  const agentProvisioning = agentRuntime
    ? new AgentProvisioningService(service, agentRuntime)
    : undefined;
  const agentDispatcher = agentRuntime
    ? new AgentMessageDispatcher(service, realtime, agentRuntime)
    : undefined;

  if (agentRuntime && agentDispatcher) {
    app.addHook("onClose", async () => {
      await agentDispatcher.close();
      await agentRuntime.close();
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Request validation failed" },
      });
    }
    if (error instanceof PeerlyError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/principals/humans", async (request, reply) => {
    const input = createHumanInputSchema.parse(request.body);
    const principal = await service.createHuman(input, actorIdFrom(request));
    return reply.status(201).send({ principal });
  });

  app.post("/api/principals/agents", async (request, reply) => {
    if (!agentProvisioning) {
      throw new PeerlyError("AGENT_RUNTIME_UNAVAILABLE", "Agent Runtime is unavailable", 503);
    }
    const input = createAgentPrincipalInputSchema.parse(request.body);
    const principal = await agentProvisioning.create(input, actorIdFrom(request));
    return reply.status(201).send({ principal });
  });

  app.get("/api/principals", async (request) => ({
    principals: service.listPrincipals(actorIdFrom(request)),
  }));

  app.get("/api/dev/principals", async () => ({
    principals: service.listDevelopmentPrincipals(),
  }));

  app.post("/api/dev/session", async (request, reply) => {
    const input = selectDevSessionInputSchema.parse(request.body);
    const principal = service.requireHumanSession(input.principalId);
    reply.setCookie(sessionCookieName, principal.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return { principal };
  });

  app.get("/api/session", async (request) => ({
    principal: service.getSessionPrincipal(actorIdFrom(request)),
  }));

  app.post("/api/conversations/direct", async (request, reply) => {
    const input = createDirectConversationInputSchema.parse(request.body);
    const result = await service.createDirectConversation(
      actorIdFrom(request),
      input.participantId,
    );
    if (result.created) {
      realtime.publish(
        { type: "conversation.created", conversation: result.value },
        result.value.participantIds,
      );
    }
    return reply.status(result.created ? 201 : 200).send({ conversation: result.value });
  });

  app.post("/api/conversations/groups", async (request, reply) => {
    const input = createGroupConversationInputSchema.parse(request.body);
    const conversation = await service.createGroupConversation(actorIdFrom(request), input);
    realtime.publish({ type: "conversation.created", conversation }, conversation.participantIds);
    return reply.status(201).send({ conversation });
  });

  app.patch("/api/conversations/:conversationId/participants", async (request) => {
    const { conversationId } = conversationParamsSchema.parse(request.params);
    const input = updateGroupParticipantsInputSchema.parse(request.body);
    const result = await service.updateGroupParticipants(
      actorIdFrom(request),
      conversationId,
      input,
    );
    realtime.publish(
      { type: "conversation.updated", conversation: result.value },
      result.recipientIds,
    );
    return { conversation: result.value };
  });

  app.get("/api/conversations", async (request) => ({
    conversations: service.listConversations(actorIdFrom(request)),
  }));

  app.post("/api/conversations/:conversationId/messages", async (request, reply) => {
    const { conversationId } = conversationParamsSchema.parse(request.params);
    const input = sendMessageInputSchema.parse(request.body);
    const result = await service.sendMessage(actorIdFrom(request), conversationId, input);
    if (result.created) {
      realtime.publish({ type: "message.created", message: result.value }, result.recipientIds);
      agentDispatcher?.dispatch(result.value);
    }
    return reply.status(result.created ? 201 : 200).send({ message: result.value });
  });

  app.get("/api/conversations/:conversationId/messages", async (request) => {
    const { conversationId } = conversationParamsSchema.parse(request.params);
    const query = listMessagesQuerySchema.parse(request.query);
    return service.listMessages(actorIdFrom(request), conversationId, query);
  });

  app.post("/api/agent-deliveries/:deliveryId/cancel", async (request, reply) => {
    if (!agentDispatcher) {
      throw new PeerlyError("AGENT_RUNTIME_UNAVAILABLE", "Agent Runtime is unavailable", 503);
    }
    const { deliveryId } = deliveryParamsSchema.parse(request.params);
    if (!agentDispatcher.cancel(deliveryId, actorIdFrom(request))) {
      throw new PeerlyError("DELIVERY_NOT_FOUND", "Active Agent delivery not found", 404);
    }
    return reply.status(202).send({ cancelled: true });
  });

  return app;
}

function actorIdFrom(request: FastifyRequest): string | undefined {
  return request.cookies[sessionCookieName];
}
