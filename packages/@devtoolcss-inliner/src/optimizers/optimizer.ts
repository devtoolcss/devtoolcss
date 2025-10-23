import type { Inspector, Node } from "@devtoolcss/inspector";
import type { ParsedCSSRules } from "@devtoolcss/parser";
import type { NodeWithId } from "../types.js";

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
  beforeTraverse(
    rootNode: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void>;

  /**
   * To be run before forcePseudoState.
   * Collects styles or performs setup before forcing pseudo state.
   */
  beforeForcePseudo(
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void>;

  /**
   * To be run after forcePseudoState cleanup.
   * Collects styles or performs cleanup after forcing pseudo state.
   */
  afterForcePseudo(
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void>;

  /**
   * To be run after rewriteSelectors before cascade.
   * Performs actions after selectors are rewritten.
   */
  afterRewriteSelectors(node: NodeWithId, rules: ParsedCSSRules): void;
}

export type OptimizerMethodArgs = {
  beforeTraverse: [rootNode: Node, inspector: Inspector, rootElement: Element];
  beforeForcePseudo: [node: Node, inspector: Inspector, rootElement: Element];
  afterForcePseudo: [node: Node, inspector: Inspector, rootElement: Element];
  afterRewriteSelectors: [node: NodeWithId, rules: ParsedCSSRules];
};
