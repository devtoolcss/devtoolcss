import type { Inspector, Node } from "@devtoolcss/inspector";
import type { ParsedCSSRules } from "@devtoolcss/parser";
import type { Optimizer } from "./optimizer.js";
import { parseCSSProperties } from "@devtoolcss/parser";
import type { NodeWithId } from "../types.js";

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
  async beforeTraverse(
    rootNode: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void> {
    try {
      rootElement.querySelectorAll("li:has([aria-expanded])").forEach((el) => {
        this.checkChildrenNodeIds.add(
          Number(el.attributes["data-nodeId"].value),
        );
      });
    } catch {}
  }

  /**
   * To be run before forcePseudoState.
   */
  async beforeForcePseudo(
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void> {
    // Collect children styles before forcing pseudo state
    if (this.checkChildrenNodeIds.has(node.nodeId) && node.children) {
      const childrenStyleBefore = [];
      for (let i = 0; i < node.children.length; ++i) {
        const child = node.children[i];
        const childrenStyle = await inspector.sendCommand(
          "CSS.getMatchedStylesForNode",
          {
            nodeId: child.nodeId,
          },
        );
        childrenStyleBefore.push(childrenStyle);
      }
      this.childrenStyleBefore.set(node.nodeId, childrenStyleBefore);
    }
  }

  /**
   * To be run before cleanup forcePseudo.
   */
  async afterForcePseudo(
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void> {
    // Collect children styles after forcing pseudo state
    if (this.checkChildrenNodeIds.has(node.nodeId) && node.children) {
      const childrenStyleAfter = [];
      for (let i = 0; i < node.children.length; ++i) {
        const child = node.children[i];
        const childrenStyle = await inspector.sendCommand(
          "CSS.getMatchedStylesForNode",
          {
            nodeId: child.nodeId,
          },
        );
        childrenStyleAfter.push(childrenStyle);
      }
      this.childrenStyleAfter.set(node.nodeId, childrenStyleAfter);
    }
  }

  /*
   * To be run after after rewriteSelectors before cascade.
   */
  afterRewriteSelectors(node: NodeWithId, rules: ParsedCSSRules): void {
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
