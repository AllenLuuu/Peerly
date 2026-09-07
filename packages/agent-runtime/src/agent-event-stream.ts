export class BufferedEventStream<T> implements AsyncIterable<T> {
  private readonly events: T[] = [];
  private readonly waiters: (() => void)[] = [];
  private ended = false;
  private consumed = false;

  push(event: T): void {
    if (this.ended) return;
    this.events.push(event);
    this.wakeWaiters();
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.wakeWaiters();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.consumed) {
      throw new Error("Agent Runtime event streams can only be consumed once");
    }
    this.consumed = true;
    let index = 0;

    return {
      next: async (): Promise<IteratorResult<T>> => {
        while (true) {
          const event = this.events[index];
          if (event !== undefined) {
            index += 1;
            return { done: false, value: event };
          }
          if (this.ended) return { done: true, value: undefined };
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
      },
    };
  }

  private wakeWaiters(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}
