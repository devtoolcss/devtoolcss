import type { Inspector, Node } from "@devtoolcss/inspector";
import type { ParsedCSSRules } from "@devtoolcss/parser";
import type { Optimizer } from "./optimizer.js";
import type { NodeWithId } from "../types.js";
import { getNormalizedSuffix } from "../utils.js";
import * as CSSwhat from "css-what";

/**
 handling li:has([aria-expanded]) nodes.
 */
export class PrunePsuedoElementOptimizer implements Optimizer {
  constructor() {}

  async beforeTraverse(
    rootNode: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void> {}

  async beforeForcePseudo(
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void> {}

  async afterForcePseudo(
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ): Promise<void> {}

  /**
   * clean up after rewriteSelectors.
   */
  afterRewriteSelectors(node: NodeWithId, rules: ParsedCSSRules): void {
    for (const [selector, properties] of Object.entries(rules)) {
      const suffix = getNormalizedSuffix(CSSwhat.parse(selector)[0]);
      if (suffix.endsWith("before") || suffix.endsWith("after")) {
        let hasIneffectiveContent = true;
        for (const prop of properties) {
          if (
            prop.name === "content" &&
            !["normal", '""', "''"].includes(prop.value)
          ) {
            hasIneffectiveContent = false;
          }
        }
        if (hasIneffectiveContent) {
          delete rules[selector];
        }
      } else if (suffix.endsWith("marker")) {
        if (node.localName !== "li") {
          delete rules[selector];
        }
      } else if (suffix.endsWith("backdrop")) {
        const canHaveBackdrop = [
          "dialog",
          "div",
          "section",
          "article",
          "main",
          "aside",
          "video",
          "img",
          "canvas",
          "iframe",
        ].includes(node.localName);
        if (!canHaveBackdrop) delete rules[selector];
      }
    }
  }
}
