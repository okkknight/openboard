export interface SerialTaskQueue {
  enqueue(task: () => Promise<void>): Promise<void>;
}

export function createSerialTaskQueue(): SerialTaskQueue {
  let tail = Promise.resolve();
  return {
    enqueue(task) {
      const next = tail.then(task);
      tail = next.catch(() => {});
      return next;
    }
  };
}
