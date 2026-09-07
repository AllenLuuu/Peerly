import {
  peerlyRealtimeEventName,
  type HumanPrincipal,
  type PeerlyRealtimeEvent,
} from "@peerly/contracts";
import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";

const sessionCookieName = "peerly_session";

export interface PeerlyRealtime {
  publish(event: PeerlyRealtimeEvent, recipientIds: readonly string[]): void;
}

export function attachPeerlyRealtime(
  app: FastifyInstance,
  resolveSession: (principalId?: string) => HumanPrincipal | null,
): PeerlyRealtime {
  const io = new Server(app.server, {
    serveClient: false,
  });

  io.use((socket, next) => {
    const cookies = app.parseCookie(socket.request.headers.cookie ?? "");
    const principal = resolveSession(cookies[sessionCookieName]);
    if (principal === null) {
      next(new Error("AUTHENTICATION_REQUIRED"));
      return;
    }
    socket.data.principalId = principal.id;
    next();
  });

  io.on("connection", (socket) => {
    const principalId = socket.data.principalId as string;
    void socket.join(roomFor(principalId));
  });

  app.addHook("onClose", () => {
    io.close();
  });

  return {
    publish(event, recipientIds) {
      for (const principalId of new Set(recipientIds)) {
        io.to(roomFor(principalId)).emit(peerlyRealtimeEventName, event);
      }
    },
  };
}

function roomFor(principalId: string): string {
  return `principal:${principalId}`;
}
