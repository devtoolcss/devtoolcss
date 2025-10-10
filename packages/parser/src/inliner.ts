import type { PseudoElement, PseudoSelector, Selector } from "css-what";
import type {
  NodeWithId,
  PseudoElementMatches,
  ParsedCSS,
  ParsedCSSPropertyObject,
} from "./types.js";
import * as CSSwhat from "css-what";

import { getNormalizedSuffix, iterateParsedCSS } from "./css_parser.js";

type ParsedCSSRulesObjValue = {
  [selector: string]: ParsedCSSPropertyObject;
};

type ParsedStyleSheetObjValue = {
  [mediaKey: string]: ParsedCSSRulesObjValue;
};

function toStyleSheet(
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

/**
 * Normalize the pseudo-class/element suffix:
 * - Removes functional pseudo-classes (e.g. :not(), :nth-child())
 * - Sorts pseudo-classes/elements alphabetically
 * - Keeps only the pseudo part (e.g. ":hover", "::before")
 */

//A pseudo-element must appear after all the other components in the complex or compound selector.

export function hasNonFuncPseudoClass(parsedSelector: Selector[]): boolean {
  for (const node of parsedSelector) {
    if (node.type === "pseudo") {
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

export function isEffectivePseudoElem(
  pseudoMatch: PseudoElementMatches,
  node: NodeWithId,
): boolean {
  const pseudoType = pseudoMatch.pseudoType;
  if (pseudoType === "before" || pseudoType === "after") {
    let content = '""';
    for (const match of pseudoMatch.matches) {
      for (const prop of match.rule.style.cssProperties) {
        if (prop.name === "content") content = prop.value;
      }
    }
    /*
	if (content !== '""' && content !== "''")
	  console.log(JSON.stringify(content));
	*/
    return content !== "normal" && content !== '""' && content !== "''";
  }

  if (pseudoType === "marker") {
    return node.localName === "LI";
  }

  return true;
}

function getRewrittenSelectors(idSelector: string, selectorList: string) {
  const rewrittenSelectors = new Set<string>();
  if (!selectorList) {
    rewrittenSelectors.add(idSelector);
  } else {
    const parsedSelectors = CSSwhat.parse(selectorList);
    for (const parsedSelector of parsedSelectors) {
      const suffix = getNormalizedSuffix(parsedSelector);
      if (!suffix && hasNonFuncPseudoClass(parsedSelector))
        // TODO: probably pseudo class in functional selector
        // currently cannot process, should not be inlined
        return;
      rewrittenSelectors.add(idSelector + suffix);
    }
  }
  return [...rewrittenSelectors];
}

export function getInlineText(
  node: NodeWithId,
  parsedCSSs: ParsedCSS[],
  mediaConditions: string[],
) {
  const mediaRules: ParsedStyleSheetObjValue = {};
  for (let i = 0; i < parsedCSSs.length; i++) {
    const parsed = parsedCSSs[i];
    const rules: ParsedCSSRulesObjValue = {};
    iterateParsedCSS(parsed, (values, selectorList) => {
      const idSelector = `#${node.id}`;
      const rewrittenSelectors = getRewrittenSelectors(
        idSelector,
        selectorList,
      );
      for (const rewrittenSelector of rewrittenSelectors) {
        if (!rules[rewrittenSelector]) rules[rewrittenSelector] = {};
        values
          .filter((v) => v.applied)
          .forEach((v) => {
            rules[rewrittenSelector][v.name] = v;
          });
      }
    });
    mediaRules[mediaConditions[i]] = rules;
  }

  const sharedCSS: ParsedCSSRulesObjValue = {};
  const [firstStyleJSON, ...otherStyleJSONs] = Object.values(mediaRules);
  if (firstStyleJSON) {
    for (const [targetSelector, targetRule] of Object.entries(firstStyleJSON)) {
      for (const [targetProp, targetValue] of Object.entries(targetRule)) {
        const isShared = otherStyleJSONs.every(
          (styleJSON) =>
            styleJSON[targetSelector] &&
            JSON.stringify(styleJSON[targetSelector][targetProp]) ===
              JSON.stringify(targetValue),
        );
        if (isShared) {
          if (!sharedCSS[targetSelector]) sharedCSS[targetSelector] = {};
          sharedCSS[targetSelector][targetProp] = targetValue;
          Object.values(mediaRules).forEach((styleJSON) => {
            if (styleJSON[targetSelector])
              delete styleJSON[targetSelector][targetProp];
          });
        }
      }
      for (const screenKey of Object.keys(mediaRules)) {
        const styleKeyJSON = mediaRules[screenKey];
        for (const selector of Object.keys(styleKeyJSON))
          if (Object.keys(styleKeyJSON[selector]).length === 0)
            delete styleKeyJSON[selector];
        if (Object.keys(mediaRules[screenKey]).length === 0)
          delete mediaRules[screenKey];
      }
    }
  }

  let style: string = "";
  if (
    Object.keys(mediaRules).length === 0 &&
    Object.keys(sharedCSS).length === 0
  ) {
  } else if (
    Object.keys(mediaRules).length === 0 &&
    Object.keys(sharedCSS).length === 1 &&
    Object.keys(sharedCSS)[0] === `#${node.id}`
  ) {
    for (const [key, value] of Object.entries(sharedCSS[`#${node.id}`])) {
      style += `${key}: ${value.value}${
        value.important ? " !important" : ""
      }; `;
    }
  } else {
    if (Object.keys(sharedCSS).length > 0) style += toStyleSheet(sharedCSS);
    for (const key of Object.keys(mediaRules)) {
      const i = parseInt(key);
      style += toStyleSheet(mediaRules[i], mediaConditions[i]);
    }
  }
  return style;
}
