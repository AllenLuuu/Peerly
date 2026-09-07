import cookie from "@fastify/cookie";
import {
  conversationIdSchema,
  createDirectConversationInputSchema,
  createHumanInputSchema,
  listMessagesQuerySchema,
  selectDevSessionInputSchema,
  sendMessageInputSchema,
} from "@peerly/contracts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";

import { PeerlyError } from "./errors.js";
import { FilePeerlyRepository } from "./file-peerly-repository.js";
import { PeerlyService, type PeerlyServiceOptions } from "./peerly-service.js";

const sessionCookieName = "peerly_session";
const conversationParamsSchema = z.strictObject({
  conversationId: conversationIdSchema,
});

export interface CreatePeerlyAppOptions extends PeerlyServiceOptions {
  dataDirectory: string;
}

export async function createPeerlyApp(options: CreatePeerlyAppOptions): Promise<FastifyInstance> {
  const repository = await FilePeerlyRepository.create(options.dataDirectory);
  const service = new PeerlyService(repository, options);
  const app = Fastify({ logger: false });

  await app.register(cookie);

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

  app.get("/api/principals", async (request) => ({
    principals: service.listPrincipals(actorIdFrom(request)),
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
    return reply.status(result.created ? 201 : 200).send({ conversation: result.value });
  });

  app.get("/api/conversations", async (request) => ({
    conversations: service.listConversations(actorIdFrom(request)),
  }));

  app.post("/api/conversations/:conversationId/messages", async (request, reply) => {
    const { conversationId } = conversationParamsSchema.parse(request.params);
    const input = sendMessageInputSchema.parse(request.body);
    const result = await service.sendMessage(actorIdFrom(request), conversationId, input);
    return reply.status(result.created ? 201 : 200).send({ message: result.value });
  });

  app.get("/api/conversations/:conversationId/messages", async (request) => {
    const { conversationId } = conversationParamsSchema.parse(request.params);
    const query = listMessagesQuerySchema.parse(request.query);
    return service.listMessages(actorIdFrom(request), conversationId, query);
  });

  return app;
}

function actorIdFrom(request: FastifyRequest): string | undefined {
  return request.cookies[sessionCookieName];
}
