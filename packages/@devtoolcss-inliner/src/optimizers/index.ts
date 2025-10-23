import { Optimizer, OptimizerMethodArgs } from "./optimizer.js";
export { AriaExpandedOptimizer } from "./AriaExpanded.js";
export { PrunePsuedoElementOptimizer } from "./PrunePseudoElement.js";

type SyncMethodNames = "afterRewriteSelectors";
type AsyncMethodNames =
  | "beforeTraverse"
  | "beforeForcePseudo"
  | "afterForcePseudo";

// Overload for async methods
export function invokeOptimizers<K extends AsyncMethodNames>(
  optimizers: Optimizer[],
  methodName: K,
  ...args: OptimizerMethodArgs[K]
): Promise<void>;

// Overload for sync methods
export function invokeOptimizers<K extends SyncMethodNames>(
  optimizers: Optimizer[],
  methodName: K,
  ...args: OptimizerMethodArgs[K]
): void;

// Implementation
export function invokeOptimizers<K extends keyof OptimizerMethodArgs>(
  optimizers: Optimizer[],
  methodName: K,
  ...args: OptimizerMethodArgs[K]
): void | Promise<void> {
  const results = optimizers.map((opt) => opt[methodName].apply(opt, args));
  // Check if any result is a Promise (async)
  if (results.some((r) => r instanceof Promise)) {
    return Promise.all(results).then(() => {}); // .then ensure Promise<void>
  }
}
