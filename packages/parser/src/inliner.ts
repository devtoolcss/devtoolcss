import postcss from "postcss";
import { postcssVarReplace } from "postcss-var-replace";
import type { PseudoElement, PseudoSelector, Selector } from "css-what";
import type {
  NodeWithId,
  ParsedCSS,
  ParsedCSSPropertyObject,
  ParsedCSSRules,
  ParsedCSSPropertyValue,
} from "./types.js";
import * as CSSwhat from "css-what";

import { iterateParsedCSS } from "./css_parser.js";

type ParsedCSSRulesObjValue = {
  [selector: string]: ParsedCSSPropertyObject;
};

type ParsedStyleSheetObjValue = {
  [mediaKey: string]: ParsedCSSRulesObjValue;
};

function getNormalizedSuffix(parsedSelector: Selector[]): string {
  const pseudoClasses = [];
  let pseudoElement = null;
  for (let i = parsedSelector.length - 1; i >= 0; --i) {
    const selector = parsedSelector[i];
    if (selector.type === "pseudo") {
      // type to PseudoSelector
      const pseudo = selector as PseudoSelector;
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
      pseudoElement = "::" + (selector as PseudoElement).name;
    } else {
      break;
    }
  }
  pseudoClasses.sort();
  return pseudoClasses.join("") + (pseudoElement ? pseudoElement : "");
}

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

export function removeIneffectivePseudoElem(
  node: NodeWithId,
  parsedRules: ParsedCSSRulesObjValue,
) {
  for (const [selector, properties] of Object.entries(parsedRules)) {
    const suffix = getNormalizedSuffix(CSSwhat.parse(selector)[0]);
    if (suffix.endsWith("before") || suffix.endsWith("after")) {
      for (const [prop, val] of Object.entries(properties)) {
        if (
          prop === "content" &&
          (val.value === "normal" || val.value === '""' || val.value === "''")
        ) {
          delete parsedRules[selector];
        }
      }
    } else if (suffix.endsWith("marker")) {
      if (node.localName !== "li") {
        delete parsedRules[selector];
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
      if (!canHaveBackdrop) delete parsedRules[selector];
    }
  }
}

function getRewrittenSelectors(
  idSelector: string,
  selectorList?: string,
): string[] {
  const rewrittenSelectors = new Set<string>();
  if (!selectorList) {
    rewrittenSelectors.add(idSelector);
  } else {
    const parsedSelectors = CSSwhat.parse(selectorList);
    for (const parsedSelector of parsedSelectors) {
      const suffix = getNormalizedSuffix(parsedSelector);
      if (!suffix && hasNonFuncPseudoClass(parsedSelector)) {
        // TODO: probably pseudo class in functional selector
        // currently cannot process, should not be inlined
        continue;
      }
      rewrittenSelectors.add(idSelector + suffix);
    }
  }
  return [...rewrittenSelectors];
}

function replaceVariables(
  rules: ParsedCSSRulesObjValue,
): ParsedCSSRulesObjValue {
  // TODO: split pseudo Elements variables
  const styleSheet = toStyleSheet(rules);
  const { root } = postcss([postcssVarReplace()]).process(styleSheet);
  const replaced: ParsedCSSRulesObjValue = {};
  root.walkRules((rule) => {
    const selector = rule.selector;
    if (!replaced[selector]) {
      replaced[selector] = {};
    }
    rule.walkDecls((decl) => {
      replaced[selector][decl.prop] = {
        name: decl.prop,
        value: decl.value,
        important: decl.important || false,
      };
    });
  });
  // cleanup
  for (const selector in replaced) {
    for (const prop in replaced[selector]) {
      if (replaced[selector][prop].value === undefined) {
        delete replaced[selector][prop];
      }
    }
    if (Object.keys(replaced[selector]).length === 0) {
      delete replaced[selector];
    }
  }
  return replaced;
}

// we use forcePseudoState for all pseudo classes, so have to recover applied for each cases
function cascade(rules: ParsedCSSRules): ParsedCSSRulesObjValue {
  const canOverride = (
    a: ParsedCSSPropertyValue,
    b: ParsedCSSPropertyValue,
  ): boolean => {
    // inherited properties can always be overridden without considering importance
    if (a.inherited) return true;
    return (
      // important has higher priority
      !(a.important && !b.important)
    );
  };
  const cascaded: ParsedCSSRulesObjValue = {};
  for (const [selector, values] of Object.entries(rules)) {
    const appliedProperties: ParsedCSSPropertyObject = {};
    for (const value of values) {
      if (
        !appliedProperties[value.name] ||
        canOverride(appliedProperties[value.name], value)
      ) {
        appliedProperties[value.name] = value; // same obj for final checking applied
      }
    }
    cascaded[selector] = appliedProperties;
  }
  return cascaded;
}

function toInlineRules(parsed: ParsedCSS, id: string): ParsedCSSRulesObjValue {
  const rules: ParsedCSSRules = {};
  iterateParsedCSS(parsed, (values, selectorList, context) => {
    const idSelector = `#${id}`;
    const rewrittenSelectors = getRewrittenSelectors(idSelector, selectorList);
    for (const rewrittenSelector of rewrittenSelectors) {
      if (!rules[rewrittenSelector]) rules[rewrittenSelector] = [];
      values.forEach((v) => {
        if (
          context !== "inherited" ||
          (context === "inherited" && v.name.startsWith("--"))
        ) {
          rules[rewrittenSelector].push(v);
        }
      });
    }
  });
  return cascade(rules);
}

export function getInlineText(
  node: NodeWithId,
  parsedCSSs: ParsedCSS[],
  mediaConditions: string[],
) {
  const mediaRules: ParsedStyleSheetObjValue = {};
  for (let i = 0; i < parsedCSSs.length; i++) {
    const parsed = parsedCSSs[i];
    const rules: ParsedCSSRulesObjValue = toInlineRules(parsed, node.id!);
    removeIneffectivePseudoElem(node, rules);

    mediaRules[mediaConditions[i]] = replaceVariables(rules);
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
    // no style
  } else if (
    Object.keys(mediaRules).length === 0 &&
    Object.keys(sharedCSS).length === 1 &&
    Object.keys(sharedCSS)[0] === `#${node.id}`
  ) {
    // style=
    for (const [key, value] of Object.entries(sharedCSS[`#${node.id}`])) {
      style += `${key}: ${value.value}${
        value.important ? " !important" : ""
      }; `;
    }
  } else {
    // <style>
    if (Object.keys(sharedCSS).length > 0) style += toStyleSheet(sharedCSS);
    Object.entries(mediaRules).forEach(([mediaCond, rules]) => {
      style += toStyleSheet(rules, mediaCond);
    });
  }
  return style;
}
