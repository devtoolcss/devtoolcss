import * as CSSwhat from "css-what";
import type { ParsedCSSRulesObjValue } from "./types.js";

export function getNormalizedSuffix(
  parsedSelector: CSSwhat.Selector[],
): string {
  const pseudoClasses = [];
  let pseudoElement = null;
  for (let i = parsedSelector.length - 1; i >= 0; --i) {
    const selector = parsedSelector[i];
    if (selector.type === "pseudo") {
      // type to PseudoSelector
      const pseudo = selector as CSSwhat.PseudoSelector;
      if (!pseudo.data && pseudo.name !== "root") {
        // exclude functional pseudo-classes and :root
        pseudoClasses.push(":" + pseudo.name);
      }
    } else if (
      selector.type === "pseudo-element" &&
      // custom selectors
      selector.name !== "inline" &&
      selector.name !== "attributes"
    ) {
      // type to PseudoElement
      pseudoElement = "::" + (selector as CSSwhat.PseudoElement).name;
    } else {
      break;
    }
  }
  pseudoClasses.sort();
  return pseudoClasses.join("") + (pseudoElement ? pseudoElement : "");
}

export function toStyleSheet(
  styleJSON: ParsedCSSRulesObjValue,
  mediaCondition: string = "",
) {
  let stylesheet = "";
  for (const [selector, rules] of Object.entries(styleJSON)) {
    const decls = Object.entries(rules)
      .map(
        ([prop, val]) =>
          `${prop}: ${val.value}${val.important ? " !important" : ""};`,
      )
      .join("");
    stylesheet += `${selector} {${decls}}`;
  }
  if (mediaCondition) {
    stylesheet = `@media ${mediaCondition} {${stylesheet}}`;
  }
  return stylesheet;
}

export function hasNonFuncPseudoClass(
  parsedSelector: CSSwhat.Selector[],
): boolean {
  for (const node of parsedSelector) {
    if (node.type === "pseudo" && node.name !== "root") {
      if (!node.data) return true;

      if (Array.isArray(node.data) && node.name !== "not") {
        for (const selector of node.data) {
          if (hasNonFuncPseudoClass(selector)) return true;
        }
      }
    }
  }
  return false;
}
