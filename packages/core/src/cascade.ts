import {
  hasPseudoClass,
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

export function cascade(
  node: NodeWithId,
  styles: GetMatchedStylesForNodeResponse,
) {
  const idSelector = `#${node.id}`;
  const css: ParsedCSSRules = { [idSelector]: {} };
  const selfStyle = css[idSelector];

  // bottleneck of speed, can take 4s for large css, though mitigated with async
  // in browser's protocol monitor only takes <50ms, corresponding to cascade total time average
  //let startTime = Date.now();
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

  for (const rule of matchedCSSRules) {
    if (rule.rule.origin !== "regular") continue;

    parseCSSProperties(
      rule.rule.style.cssProperties,
      rule.rule.style.cssText,
      selfStyle,
    );
  }

  if (inlineStyle)
    parseCSSProperties(
      inlineStyle.cssProperties,
      inlineStyle.cssText,
      selfStyle,
    );

  for (const match of pseudoElements) {
    //match.pseudoType
    if (isEffectivePseudoElem(match, node)) {
      for (const rule of match.matches) {
        if (rule.rule.origin !== "regular") continue;
        const key = `${idSelector}::${match.pseudoType}`;
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

function iteratePseudo(
  idSelector: string,
  rules: RuleMatch[],
  pseudoCss: ParsedCSSRules,
) {
  for (const rule of rules) {
    if (rule.rule.origin !== "regular") continue;
    const matchingSelectors = rule.matchingSelectors.map(
      (i) => rule.rule.selectorList.selectors[i].text,
    );
    for (const selector of matchingSelectors) {
      const parsedSelector = CSSwhat.parse(selector)[0];
      if (hasPseudoClass(parsedSelector)) {
        const selector = idSelector + getNormalizedSuffix(parsedSelector);
        if (!selector) continue;
        parseCSSProperties(
          rule.rule.style.cssProperties,
          rule.rule.style.cssText,
          (pseudoCss[selector] = pseudoCss[selector] || {}),
        );
      }
    }
  }
}

export function cascadePseudoClass(
  node: NodeWithId,
  styles: GetMatchedStylesForNodeResponse,
  childrenStyleBefore: GetMatchedStylesForNodeResponse[] = [],
  childrenStyleAfter: GetMatchedStylesForNodeResponse[] = [],
) {
  const idSelector = `#${node.id}`;
  const pseudoCss: ParsedCSSRules = {};

  const { matchedCSSRules, pseudoElements } = styles;

  iteratePseudo(idSelector, matchedCSSRules, pseudoCss);
  for (const match of pseudoElements) {
    if (isEffectivePseudoElem(match, node)) {
      iteratePseudo(idSelector, match.matches, pseudoCss);
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
          const suffix = `${idSelector}:hover > #${node.children[i].id}`;
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
