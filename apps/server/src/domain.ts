import type { Conversation, Message, Principal } from "@peerly/contracts";

export interface Organization {
  id: string;
  name: string;
}

export interface PeerlyState {
  organization: Organization;
  principals: Principal[];
  conversations: Conversation[];
}

export interface PeerlyRepository {
  readState(): PeerlyState;
  saveState(state: PeerlyState): Promise<void>;
  readMessages(conversationId: string): Promise<Message[]>;
  appendMessage(message: Message): Promise<void>;
}
