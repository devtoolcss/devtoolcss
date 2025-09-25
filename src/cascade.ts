import {
  pseudoClasses,
  hasPseudoClass,
  parseCSSProperties,
  getNormalizedSuffix,
  isEffectivePseudoElem,
} from "./css_parser.js";

import * as CSSwhat from "css-what";

import type { Node, CSSApi, RuleMatch, CSSRules } from "./types.js";

export async function cascade(node: Node, CSS: CSSApi, screenSize: number) {
  const css = { "": {} };

  var {
    inherited,
    inlineStyle,
    attributesStyle,
    matchedCSSRules,
    pseudoElements,
  } = await CSS.getMatchedStylesForNode({ nodeId: node.nodeId });

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

  node.css[screenSize] = css;
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

export async function cascadePseudoClass(
  node: Node,
  CSS: CSSApi,
  screenSize: number,
  checkChildren: boolean,
) {
  const pseudoCss: CSSRules = {};

  const childRuleSerializedSets = [];
  if (checkChildren && node.children) {
    // use for loop to await, forEach will not
    for (var i = 0; i < node.children.length; ++i) {
      const child = node.children[i];
      const { matchedCSSRules } = await CSS.getMatchedStylesForNode({
        nodeId: child.nodeId,
      });
      const s = new Set();
      for (const ruleMatch of matchedCSSRules) {
        s.add(JSON.stringify(ruleMatch));
      }
      childRuleSerializedSets.push(s);
    }
  }

  await CSS.forcePseudoState({
    nodeId: node.nodeId,
    forcedPseudoClasses: pseudoClasses,
  });

  var { matchedCSSRules, pseudoElements } = await CSS.getMatchedStylesForNode({
    nodeId: node.nodeId,
  });

  iteratePseudo(matchedCSSRules, pseudoCss);
  for (const match of pseudoElements) {
    if (isEffectivePseudoElem(match, node)) {
      iteratePseudo(match.matches, pseudoCss);
    }
  }

  if (checkChildren) {
    for (var i = 0; i < node.children.length; ++i) {
      const child = node.children[i];
      const { matchedCSSRules } = await CSS.getMatchedStylesForNode({
        nodeId: child.nodeId,
      });
      for (const ruleMatch of matchedCSSRules) {
        if (!childRuleSerializedSets[i].has(JSON.stringify(ruleMatch))) {
          // TODO: parse selector to determine pseudo class
          const suffix = `:hover > #${child.id}`;
          parseCSSProperties(
            ruleMatch.rule.style.cssProperties,
            ruleMatch.rule.style.cssText,
            (pseudoCss[suffix] = pseudoCss[suffix] || {}),
          );
        }
      }
    }
  }

  await CSS.forcePseudoState({
    nodeId: node.nodeId,
    forcedPseudoClasses: [],
  });

  node.css[screenSize] = { ...node.css[screenSize], ...pseudoCss };
}
