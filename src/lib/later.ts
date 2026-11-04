import { AsyncLocalStorage } from "node:async_hooks";

type Task = () => Promise<unknown>;
const queue = new AsyncLocalStorage<Task[]>();

/**
 * Work that should not hold up the answer (keeping a Google event in step): inside `withLater` it
 * runs after the event is answered; anywhere else it runs now. A failure is never the caller's.
 */
export async function later(task: Task): Promise<void> {
  const tasks = queue.getStore();
  if (tasks) {
    tasks.push(task);
    return;
  }
  await task().catch(() => undefined);
}

/** Run `fn`, then whatever it put off with `later`, in order. */
export async function withLater<T>(fn: () => Promise<T>): Promise<T> {
  const tasks: Task[] = [];
  try {
    return await queue.run(tasks, fn);
  } finally {
    for (const task of tasks) await task().catch(() => undefined);
  }
}
