import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();
export const currentPipeline = (): string | undefined => storage.getStore();
export function withPipeline<T>(pipeline: string, run: () => T): T {
  return storage.run(pipeline, run);
}
