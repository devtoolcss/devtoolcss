import type { ParsedCSSRules, CDPNodeWithId } from "../types.js";
import type {
  Inspector,
  InspectorNode,
  InspectorElement,
} from "chrome-inspector";

/**
 * Optimizer interface for CSS optimizations.
 * Defines hooks for traversing and rewriting selectors.
 */
export interface Optimizer {
  // constructor arg should be empty

  /**
   * To be run in beforeTraverse.
   * Collects nodeIds or performs setup before traversal.
   */
  beforeTraverse(root: InspectorElement): Promise<void>;

  /**
   * To be run before forcePseudoState.
   * Collects styles or performs setup before forcing pseudo state.
   */
  beforeForcePseudo(element: InspectorElement): Promise<void>;

  /**
   * To be run after forcePseudoState cleanup.
   * Collects styles or performs cleanup after forcing pseudo state.
   */
  afterForcePseudo(element: InspectorElement): Promise<void>;

  /**
   * To be run after rewriteSelectors before cascade.
   * Performs actions after selectors are rewritten.
   */
  afterRewriteSelectors(node: CDPNodeWithId, rules: ParsedCSSRules): void;
}
