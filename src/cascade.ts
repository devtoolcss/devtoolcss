import {
  pseudoClasses,
  hasPseudoClass,
  parseCSSProperties,
  getNormalizedSuffix,
  isEffectivePseudoElem,
} from "./css_parser.js";

import * as CSSwhat from "css-what";

import type { Node, CSSApi, RuleMatch } from "./types.js";

export async function cascade(node: Node, CSS: CSSApi, screenSize: number) {
  //BUG: sometimes svg or some div nodeId=0
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
  // normal css always not important
  /*
        Object.entries(css).forEach(([key, value]) => {
          Object.values(value).forEach((prop) => {
            prop.important = false;
          });
        });
        */

  node.css[screenSize] = css;
}

export async function cascadePseudoClass(
  node: Node,
  CSS: CSSApi,
  screenSize: number,
) {
  const pseudoCss = {};
  //BUG: sometimes svg or some div nodeId=0
  /*
				const propertiesToTrack = [
					{ name: "color", value: "black" },
					//{ name: "color", value: "red" },
				];
				for (const [name, values] of Object.entries(computedStyles)) {
					for (const value of values) {
						propertiesToTrack.push({ name, value });
					}
				}
				console.log("nodeId", node.children[0].nodeId);

				await CSS.trackComputedStyleUpdates({
					propertiesToTrack,
				});

				console.log("takeComputedStyleUpdates");
				const p = CSS.takeComputedStyleUpdates();
				*/

  await CSS.forcePseudoState({
    nodeId: node.nodeId,
    forcedPseudoClasses: pseudoClasses,
  });

  /*
				console.log("await takeComputedStyleUpdates");
				const UpdatedNodeIds = await p;
				console.log("updated nodes", UpdatedNodeIds);

				await CSS.trackComputedStyleUpdates({ propertiesToTrack: [] });
				*/

  var { matchedCSSRules, pseudoElements } = await CSS.getMatchedStylesForNode({
    nodeId: node.nodeId,
  });

  function iteratePseudo(rules: RuleMatch[]) {
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

  iteratePseudo(matchedCSSRules);
  for (const match of pseudoElements) {
    if (isEffectivePseudoElem(match, node)) {
      iteratePseudo(match.matches);
    }
  }

  // TODO: to solve hover a and show b problem, use nodeId as id and construct #a #b selector.
  // select right pseudo class by search the : and verify the selector prefix

  await CSS.forcePseudoState({
    nodeId: node.nodeId,
    forcedPseudoClasses: [],
  });

  /*
				Object.entries(pseudoCss).forEach(([key, value]) => {
					Object.values(value).forEach((prop) => {
						prop.important = true;
					});
				});
				*/

  node.css[screenSize] = { ...node.css[screenSize], ...pseudoCss };
}
