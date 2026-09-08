import type {
  ConflictedAgentReply,
  PublishedAgentReply,
  RuntimeMessage,
} from "@peerly/agent-protocol";

export class AgentConversationMailbox {
  readonly #pending = new Map<number, RuntimeMessage>();
  readonly #seenSequences = new Set<number>();
  #observedSequence = 0;

  get observedSequence(): number {
    return this.#observedSequence;
  }

  enqueue(messages: readonly RuntimeMessage[]): void {
    for (const message of messages) {
      if (this.#seenSequences.has(message.sequence)) continue;
      this.#seenSequences.add(message.sequence);
      this.#pending.set(message.sequence, message);
    }
  }

  takePending(): RuntimeMessage[] {
    const messages = [...this.#pending.values()].sort(
      (left, right) => left.sequence - right.sequence,
    );
    this.#pending.clear();
    this.#observeThrough(messages.at(-1)?.sequence);
    return messages;
  }

  observeConflict(result: ConflictedAgentReply): void {
    for (const message of result.messages) {
      this.#seenSequences.add(message.sequence);
      this.#pending.delete(message.sequence);
    }
    this.#observeThrough(result.latestSequence);
  }

  observePublished(result: PublishedAgentReply): void {
    this.enqueue(result.messages);
    this.#seenSequences.add(result.sequence);
    this.#pending.delete(result.sequence);
    this.#observeThrough(result.sequence);
  }

  #observeThrough(sequence: number | undefined): void {
    if (sequence !== undefined) this.#observedSequence = Math.max(this.#observedSequence, sequence);
  }
}
