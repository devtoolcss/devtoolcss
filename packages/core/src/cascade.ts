import {
  hasNonFuncPseudoClass,
  parseCSSProperties,
  getNormalizedSuffix,
  isEffectivePseudoElem,
} from "./css_parser.js";

import * as CSSwhat from "css-what";

import type {
  RuleMatch,
  ParsedCSSRules,
  NodeWithId,
  GetMatchedStylesForNodeResponse,
} from "./types.js";

function iterateRules(
  idSelector: string,
  rules: RuleMatch[],
  css: ParsedCSSRules,
) {
  for (const rule of rules) {
    if (rule.rule.origin !== "regular") continue;
    const matchingSelectors = rule.matchingSelectors.map(
      (i) => rule.rule.selectorList.selectors[i].text,
    );
    for (const matchingSelector of matchingSelectors) {
      const parsedSelector = CSSwhat.parse(matchingSelector)[0];
      const suffix = getNormalizedSuffix(parsedSelector);

      if (!suffix && hasNonFuncPseudoClass(parsedSelector))
        // TODO: probably pseudo class in functional selector
        // currently cannot process, should not be written in normal css
        continue;

      const selector = idSelector + suffix;
      parseCSSProperties(
        rule.rule.style.cssProperties,
        rule.rule.style.cssText,
        (css[selector] = css[selector] || {}),
      );
    }
  }
}

export function cascade(
  node: NodeWithId,
  styles: GetMatchedStylesForNodeResponse,
  childrenStyleBefore: GetMatchedStylesForNodeResponse[] = [],
  childrenStyleAfter: GetMatchedStylesForNodeResponse[] = [],
) {
  const idSelector = `#${node.id}`;
  const css: ParsedCSSRules = { [idSelector]: {} };
  const selfStyle = css[idSelector];

  const {
    inherited,
    inlineStyle,
    attributesStyle,
    matchedCSSRules,
    pseudoElements,
  } = styles;

  if (inherited) {
    for (let i = inherited.length - 1; i >= 0; i--) {
      const inheritedStyle = inherited[i];
      if (inheritedStyle.inlineStyle) {
        parseCSSProperties(
          inheritedStyle.inlineStyle.cssProperties,
          inheritedStyle.inlineStyle.cssText,
          selfStyle,
          true,
        );
      }
      if (inheritedStyle.matchedCSSRules) {
        for (const rule of inheritedStyle.matchedCSSRules) {
          if (rule.rule.origin !== "regular") continue;
          parseCSSProperties(
            rule.rule.style.cssProperties,
            rule.rule.style.cssText,
            selfStyle,
            true,
          );
        }
      }
    }
  }

  if (attributesStyle)
    parseCSSProperties(
      attributesStyle.cssProperties,
      attributesStyle.cssText,
      selfStyle,
    );

  iterateRules(idSelector, matchedCSSRules, css);
  for (const match of pseudoElements) {
    if (isEffectivePseudoElem(match, node)) {
      iterateRules(idSelector, match.matches, css);
    }
  }

  if (inlineStyle)
    parseCSSProperties(
      inlineStyle.cssProperties,
      inlineStyle.cssText,
      selfStyle,
    );

  if (childrenStyleBefore.length > 0 && childrenStyleAfter.length > 0) {
    for (let i = 0; i < node.children.length; ++i) {
      const serializedRuleSet = new Set();
      for (const ruleMatch of childrenStyleBefore[i].matchedCSSRules) {
        serializedRuleSet.add(JSON.stringify(ruleMatch));
      }
      for (const ruleMatch of childrenStyleAfter[i].matchedCSSRules) {
        if (!serializedRuleSet.has(JSON.stringify(ruleMatch))) {
          // TODO: parse selector to determine pseudo class
          const suffix = `${idSelector}:hover > #${node.children[i].id}`;
          parseCSSProperties(
            ruleMatch.rule.style.cssProperties,
            ruleMatch.rule.style.cssText,
            (css[suffix] = css[suffix] || {}),
          );
        }
      }
    }
  }

  return css;
}
