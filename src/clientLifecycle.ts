import * as path from "node:path";

interface Operation {
  kind: string;
  run: () => Promise<void>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Serializes lifecycle changes per client; adjacent queued starts share one restart. */
export class ClientLifecycleQueue {
  private readonly queues = new Map<string, Operation[]>();

  run(key: string, kind: "start" | "stop", run: () => Promise<void>): Promise<void> {
    const queue = this.queues.get(key);
    const last = queue?.at(-1);
    // The first entry is already executing. Only coalesce queued work, and
    // never cross a stop (folder removal and shutdown must preserve order).
    if (kind === "start" && queue && queue.length > 1 && last?.kind === kind) {
      last.run = run;
      return last.promise;
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const operation = { kind, run, promise, resolve, reject };
    if (queue) queue.push(operation);
    else {
      this.queues.set(key, [operation]);
      void this.drain(key);
    }
    return promise;
  }

  keys(): string[] {
    return [...this.queues.keys()];
  }

  private async drain(key: string): Promise<void> {
    const queue = this.queues.get(key)!;
    while (queue.length) {
      const operation = queue[0];
      try {
        await operation.run();
        operation.resolve();
      } catch (error) {
        operation.reject(error);
      }
      queue.shift();
    }
    this.queues.delete(key);
  }
}

/** Config paths are interpreted relative to the server's working directory. */
export function usesConfigFile(configPath: string, workspaceRoot: string | undefined, changedPath: string): boolean {
  return configPath.length > 0 &&
    path.resolve(workspaceRoot ?? process.cwd(), configPath) === path.resolve(changedPath);
}
