import {
  hasPseudoClass,
  parseCSSProperties,
  getNormalizedSuffix,
  isEffectivePseudoElem,
} from "./css_parser.js";

import * as CSSwhat from "css-what";

import type {
  Node,
  RuleMatch,
  CSSRules,
  GetMatchedStylesForNodeResponse,
} from "./types.js";

export function cascade(node: Node, styles: GetMatchedStylesForNodeResponse) {
  const css = { "": {} };

  // bottleneck of speed, can take 4s for large css, though mitigated with async
  // in browser's protocol monitor only takes <50ms, corresponding to cascade total time average
  //var startTime = Date.now();
  const {
    inherited,
    inlineStyle,
    attributesStyle,
    matchedCSSRules,
    pseudoElements,
  } = styles;

  //console.log("getMatchedStylesForNode", Date.now() - startTime);

  // the rest takes <100ms

  if (inherited) {
    for (let i = inherited.length - 1; i >= 0; i--) {
      const inheritedStyle = inherited[i];
      if (inheritedStyle.inlineStyle) {
        parseCSSProperties(
          inheritedStyle.inlineStyle.cssProperties,
          inheritedStyle.inlineStyle.cssText,
          css[""],
          true,
        );
      }
      if (inheritedStyle.matchedCSSRules) {
        for (const rule of inheritedStyle.matchedCSSRules) {
          if (rule.rule.origin !== "regular") continue;
          parseCSSProperties(
            rule.rule.style.cssProperties,
            rule.rule.style.cssText,
            css[""],
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
      css[""],
    );

  for (const rule of matchedCSSRules) {
    if (rule.rule.origin !== "regular") continue;

    parseCSSProperties(
      rule.rule.style.cssProperties,
      rule.rule.style.cssText,
      css[""],
    );
  }

  if (inlineStyle)
    parseCSSProperties(inlineStyle.cssProperties, inlineStyle.cssText, css[""]);

  for (const match of pseudoElements) {
    //match.pseudoType
    if (isEffectivePseudoElem(match, node)) {
      for (const rule of match.matches) {
        if (rule.rule.origin !== "regular") continue;
        const key = "::" + match.pseudoType;
        parseCSSProperties(
          rule.rule.style.cssProperties,
          rule.rule.style.cssText,
          (css[key] = css[key] || {}),
        );
      }
    }
  }
  return css;
}

function iteratePseudo(rules: RuleMatch[], pseudoCss: CSSRules) {
  for (const rule of rules) {
    if (rule.rule.origin !== "regular") continue;
    const matchingSelectors = rule.matchingSelectors.map(
      (i) => rule.rule.selectorList.selectors[i].text,
    );
    for (const selector of matchingSelectors) {
      const parsedSelector = CSSwhat.parse(selector)[0];
      if (hasPseudoClass(parsedSelector)) {
        const suffix = getNormalizedSuffix(parsedSelector);
        if (!suffix) continue;
        parseCSSProperties(
          rule.rule.style.cssProperties,
          rule.rule.style.cssText,
          (pseudoCss[suffix] = pseudoCss[suffix] || {}),
        );
      }
    }
  }
}

export function cascadePseudoClass(
  node: Node,
  styles: GetMatchedStylesForNodeResponse,
  childrenStyleBefore: GetMatchedStylesForNodeResponse[] = [],
  childrenStyleAfter: GetMatchedStylesForNodeResponse[] = [],
) {
  const pseudoCss: CSSRules = {};

  const { matchedCSSRules, pseudoElements } = styles;

  iteratePseudo(matchedCSSRules, pseudoCss);
  for (const match of pseudoElements) {
    if (isEffectivePseudoElem(match, node)) {
      iteratePseudo(match.matches, pseudoCss);
    }
  }

  if (childrenStyleBefore.length > 0 && childrenStyleAfter.length > 0) {
    for (let i = 0; i < node.children.length; ++i) {
      const serializedRuleSet = new Set();
      for (const ruleMatch of childrenStyleBefore[i].matchedCSSRules) {
        serializedRuleSet.add(JSON.stringify(ruleMatch));
      }
      for (const ruleMatch of childrenStyleAfter[i].matchedCSSRules) {
        if (!serializedRuleSet.has(JSON.stringify(ruleMatch))) {
          // TODO: parse selector to determine pseudo class
          const suffix = `:hover > #${node.children[i].id}`;
          parseCSSProperties(
            ruleMatch.rule.style.cssProperties,
            ruleMatch.rule.style.cssText,
            (pseudoCss[suffix] = pseudoCss[suffix] || {}),
          );
        }
      }
    }
  }

  return pseudoCss;
}
