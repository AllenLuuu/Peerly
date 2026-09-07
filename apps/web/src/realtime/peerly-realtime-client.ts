import {
  peerlyRealtimeEventName,
  peerlyRealtimeEventSchema,
  type PeerlyRealtimeEvent,
} from "@peerly/contracts";
import { io, type Socket } from "socket.io-client";

export interface PeerlyRealtimeHandlers {
  onEvent(event: PeerlyRealtimeEvent): void;
  onConnected(): void;
}

export interface PeerlyRealtimeClient {
  connect(handlers: PeerlyRealtimeHandlers): void;
  disconnect(): void;
}

export class SocketPeerlyRealtimeClient implements PeerlyRealtimeClient {
  #socket: Socket | undefined;

  connect(handlers: PeerlyRealtimeHandlers): void {
    this.disconnect();
    let hasConnected = false;
    const socket = io({
      autoConnect: false,
      withCredentials: true,
    });
    this.#socket = socket;
    socket.on(peerlyRealtimeEventName, (candidate: unknown) => {
      const result = peerlyRealtimeEventSchema.safeParse(candidate);
      if (result.success) handlers.onEvent(result.data);
    });
    socket.on("connect", () => {
      if (hasConnected) handlers.onConnected();
      hasConnected = true;
    });
    socket.connect();
  }

  disconnect(): void {
    this.#socket?.disconnect();
    this.#socket = undefined;
  }
}
