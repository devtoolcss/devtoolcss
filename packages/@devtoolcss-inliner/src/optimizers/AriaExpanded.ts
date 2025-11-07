import type { Optimizer } from "./optimizer.js";
import { parseCSSProperties } from "@devtoolcss/parser";
import type { ParsedCSSRules, CDPNodeWithId } from "../types.js";
import type { InspectorElement } from "chrome-inspector";

/**
 handling li:has([aria-expanded]) nodes.
 */
export class AriaExpandedOptimizer implements Optimizer {
  checkChildrenNodeIds: Set<number>;
  childrenStyleBefore: Map<number, any[]>;
  childrenStyleAfter: Map<number, any[]>;

  constructor() {
    this.checkChildrenNodeIds = new Set();
    this.childrenStyleBefore = new Map();
    this.childrenStyleAfter = new Map();
  }

  /**
   * To be run in beforeTraverse.
   * Collects li:has([aria-expanded]) nodeIds from the rootElement.
   */
  async beforeTraverse(root: InspectorElement): Promise<void> {
    try {
      root.querySelectorAll("li:has([aria-expanded])").forEach((el) => {
        this.checkChildrenNodeIds.add(Number(el._cdpNode.nodeId));
      });
    } catch {}
  }

  /**
   * To be run before forcePseudoState.
   */
  async beforeForcePseudo(element: InspectorElement): Promise<void> {
    // Collect children styles before forcing pseudo state
    if (
      this.checkChildrenNodeIds.has(element._cdpNode.nodeId) &&
      element.children
    ) {
      const childrenStyleBefore = [];
      for (const child of element.children) {
        const childrenStyle = await child.getMatchedStyles();
        childrenStyleBefore.push(childrenStyle);
      }
      this.childrenStyleBefore.set(
        element._cdpNode.nodeId,
        childrenStyleBefore,
      );
    }
  }

  /**
   * To be run before cleanup forcePseudo.
   */
  async afterForcePseudo(element: InspectorElement): Promise<void> {
    // Collect children styles after forcing pseudo state
    if (
      this.checkChildrenNodeIds.has(element._cdpNode.nodeId) &&
      element.children
    ) {
      const childrenStyleAfter = [];
      for (const child of element.children) {
        const childrenStyle = await child.getMatchedStyles();
        childrenStyleAfter.push(childrenStyle);
      }
      this.childrenStyleAfter.set(element._cdpNode.nodeId, childrenStyleAfter);
    }
  }

  /*
   * To be run after after rewriteSelectors before cascade.
   */
  afterRewriteSelectors(node: CDPNodeWithId, rules: ParsedCSSRules): void {
    const childrenStyleBefore = this.childrenStyleBefore.get(node.nodeId) || [];
    const childrenStyleAfter = this.childrenStyleAfter.get(node.nodeId) || [];

    if (childrenStyleBefore.length > 0 && childrenStyleAfter.length > 0) {
      for (let i = 0; i < node.children.length; ++i) {
        const serializedRuleSet = new Set();
        for (const ruleMatch of childrenStyleBefore[i].matchedCSSRules) {
          serializedRuleSet.add(JSON.stringify(ruleMatch));
        }
        for (const ruleMatch of childrenStyleAfter[i].matchedCSSRules) {
          if (!serializedRuleSet.has(JSON.stringify(ruleMatch))) {
            // TODO: parse selector to determine pseudo class
            const selector = `#${node.id}:hover > #${node.children[i].id}`;
            if (!rules[selector]) rules[selector] = [];
            rules[selector].push(...parseCSSProperties(ruleMatch.rule.style));
          }
        }
      }
    }
  }
}
