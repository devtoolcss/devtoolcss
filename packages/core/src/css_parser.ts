import { postcssVarReplace } from "postcss-var-replace";
import postcss from "postcss";

import type { PseudoElement, PseudoSelector, Selector } from "css-what";
import type {
  NodeWithId,
  PseudoElementMatches,
  ParsedCSSRules,
  CSSProperty,
} from "./types.js";

export const separators = [
  "child",
  "parent",
  "sibling",
  "adjacent",
  "descendant",
  "column-combinator",
];

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

/**
 * Normalize the pseudo-class/element suffix:
 * - Removes functional pseudo-classes (e.g. :not(), :nth-child())
 * - Sorts pseudo-classes/elements alphabetically
 * - Keeps only the pseudo part (e.g. ":hover", "::before")
 */

//A pseudo-element must appear after all the other components in the complex or compound selector.

export function getNormalizedSuffix(parsedSelector: Selector[]): string {
  const pseudoClasses = [];
  let pseudoElement = null;
  for (let i = parsedSelector.length - 1; i >= 0; --i) {
    if (parsedSelector[i].type === "pseudo") {
      // type to PseudoSelector
      const pseudo = parsedSelector[i] as PseudoSelector;
      if (!pseudo.data) {
        // exclude functional pseudo-classes
        pseudoClasses.push(":" + pseudo.name);
      }
    } else if (parsedSelector[i].type === "pseudo-element") {
      // type to PseudoElement
      pseudoElement = "::" + (parsedSelector[i] as PseudoElement).name;
    } else {
      break;
    }
  }
  pseudoClasses.sort();
  return pseudoClasses.join("") + (pseudoElement ? pseudoElement : "");
}

export function parseCSSProperties(
  cssProperties: CSSProperty[],
  cssText: string,
  css: ParsedCSSRules[string],
  variableOnly = false,
) {
  for (const prop of cssProperties) {
    // override to my definition
    //prop.explicit = Boolean(prop.range); // have false negative
    if (prop.important) {
      prop.value = prop.value.replace(/\s*!important\s*$/, "");
    }

    // longhandProperties not exist if first arg is var
    // padding: var(--lp-section-padding-top) var(--lp-section-padding-x) var(--lp-section-padding-bottom);

    const explicit = new RegExp(`(^|[^-])${prop.name}`).test(cssText);

    if (prop.disabled || prop.parsedOk === false) {
      // disable: commented property
      continue;
    } else if (prop.name[0] === "-" && prop.name[1] !== "-") {
      // vendor prefix
      continue;
    } else if (
      !css[prop.name] ||
      (!(css[prop.name].important && !prop.important) &&
        // handle followed dup (bug?) without range (implicit)
        !(css[prop.name].value === prop.value && !explicit))
    ) {
      if (!variableOnly || (variableOnly && prop.name.startsWith("--"))) {
        css[prop.name] = {
          value: prop.value,
          important: Boolean(prop.important),
          explicit: explicit, //!longhandProperties.has(prop.name), //prop.explicit,
        };
      }
    }
  }
}

// if have media than cannot convert back to JSON
export function toStyleSheet(
  styleJSON: ParsedCSSRules,
  mediaMinWidth: number | undefined = undefined,
  mediaMaxWidth: number | undefined = undefined,
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
  if (mediaMinWidth || mediaMaxWidth) {
    // Indent each line of the stylesheet
    if (mediaMinWidth && mediaMaxWidth) {
      stylesheet = `@media (width >= ${mediaMinWidth}px) and (width < ${mediaMaxWidth}px) {${stylesheet}}`;
    } else if (mediaMinWidth) {
      stylesheet = `@media (width >= ${mediaMinWidth}px) {${stylesheet}}`;
    } else {
      // mediaMaxWidth
      stylesheet = `@media (width < ${mediaMaxWidth}px) {${stylesheet}}`;
    }
  }
  return stylesheet;
}

export function replaceVariables(styleSheet: string): string {
  const { css: cssReplaced } = postcss([postcssVarReplace()]).process(
    styleSheet,
  );

  // Parse the CSS using postcss
  const root = postcss.parse(cssReplaced);

  // Merge rules with the same selector
  const selectorMap = new Map();

  root.walkRules((rule) => {
    const selector = rule.selector;
    if (!selectorMap.has(selector)) {
      selectorMap.set(selector, []);
    }
    selectorMap.get(selector).push(rule);
  });

  // Create a new root for merged rules
  const mergedRoot = postcss.root();

  for (const [selector, rules] of selectorMap.entries()) {
    const propMap = new Map();
    // Later rules override earlier ones
    for (const rule of rules) {
      rule.walkDecls((decl) => {
        propMap.set(decl.prop, decl);
      });
    }
    const mergedRule = postcss.rule({ selector });
    for (const decl of propMap.values()) {
      mergedRule.append(decl.clone());
    }
    mergedRoot.append(mergedRule);
  }

  //console.log(mergedRoot.toString());
  return mergedRoot.toString();
}

export function toStyleJSON(styleSheet: string): ParsedCSSRules {
  const root = postcss.parse(styleSheet);
  const result: ParsedCSSRules = {};

  root.walkRules((rule) => {
    const selector = rule.selector;
    if (!result[selector]) result[selector] = {};
    rule.walkDecls((decl) => {
      result[selector][decl.prop] = {
        value: decl.value,
        important: decl.important,
      };
    });
  });

  return result;
}
