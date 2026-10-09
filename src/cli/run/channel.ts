/** A push-based async iterable: the orchestrator pushes, the TUI consumes. */
export interface Channel<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
}

export function createChannel<T>(): Channel<T> {
  const buffer: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else buffer.push(value);
    },
    close() {
      closed = true;
      for (const waiter of waiters.splice(0)) waiter({ value: undefined as never, done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length) return Promise.resolve({ value: buffer.shift()!, done: false });
          if (closed) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    },
  };
}
