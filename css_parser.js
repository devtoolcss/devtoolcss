import postcss from "postcss";
import { postcssVarReplace } from "postcss-var-replace";

export const pseudoClasses = ["active", "hover", "focus"];

// prettier-ignore
export const pseudoElements = ["first-line"," first-letter"," checkmark"," before"," after"," picker-icon"," interest-hint"," marker"," backdrop"," column"," selection"," search-text"," target-text"," spelling-error"," grammar-error"," highlight"," first-line-inherited"," scroll-marker"," scroll-marker-group"," scroll-button"," scrollbar"," scrollbar-thumb"," scrollbar-button"," scrollbar-track"," scrollbar-track-piece"," scrollbar-corner"," resizer"," input-list-button"," view-transition"," view-transition-group"," view-transition-image-pair"," view-transition-group-children"," view-transition-old"," view-transition-new"," placeholder"," file-selector-button"," details-content"," picker"," permission-icon"]

export const separators = [
  "child",
  "parent",
  "sibling",
  "adjacent",
  "descendant",
  "column-combinator",
];

export function isEffectivePseudoElem(pseudoMatch, node) {
  const pseudoType = pseudoMatch.pseudoType;
  if (pseudoType === "before" || pseudoType === "after") {
    var content = '""';
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
  if (pseudoType === "placeholder") {
    return ["INPUT", "TEXTAREA"].includes(node.localName);
  }

  return true;
}

export function hasPseudoClass(parsedSelector) {
  return parsedSelector.some((node) => node.type === "pseudo");
}

/**
 * Normalize the pseudo-class/element suffix:
 * - Removes functional pseudo-classes (e.g. :not(), :nth-child())
 * - Sorts pseudo-classes/elements alphabetically
 * - Keeps only the pseudo part (e.g. ":hover", "::before")
 */

//A pseudo-element must appear after all the other components in the complex or compound selector.

export function getNormalizedSuffix(parsedSelector) {
  const pseudoClasses = [];
  var pseudoElement = null;
  for (var i = parsedSelector.length - 1; i >= 0; --i) {
    if (parsedSelector[i].type === "pseudo") {
      if (!parsedSelector[i].data) {
        // exclude functional pseudo-classes
        pseudoClasses.push(":" + parsedSelector[i].name);
      }
    } else if (parsedSelector[i].type === "pseudo-element") {
      pseudoElement = "::" + parsedSelector[i].name;
    } else {
      break;
    }
  }
  pseudoClasses.sort();
  return pseudoClasses.join("") + (pseudoElement ? pseudoElement : "");
}

export function parseCSSProperties(cssProperties, css, variableOnly = false) {
  //console.log(cssProperties);
  const longhandProperties = new Set();
  for (const prop of cssProperties) {
    // override to my definition
    //prop.explicit = Boolean(prop.range); // have false negative
    if (prop.important) {
      prop.value = prop.value.replace(/\s*!important\s*$/, "");
    }

    if (prop.longhandProperties) {
      for (const longhand of prop.longhandProperties) {
        longhandProperties.add(longhand.name);
      }
    }

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
        !(css[prop.name].value === prop.value && !prop.explicit))
    ) {
      if (!variableOnly || (variableOnly && prop.name.startsWith("--"))) {
        css[prop.name] = {
          value: prop.value,
          important: Boolean(prop.important),
          explicit: !longhandProperties.has(prop.name), //prop.explicit,
        };
      }
    }
  }
}
export function toStyleSheet(css, mediaMinWidth = null, mediaMaxWidth = null) {
  var stylesheet = "";
  for (const [selector, rules] of Object.entries(css)) {
    const decls = Object.entries(rules)
      .map(
        ([prop, val]) =>
          `${prop}: ${val.value}${val.important ? " !important" : ""};`
      )
      .join("\n");
    stylesheet += `${selector} {\n${decls}\n}\n`;
  }
  if (mediaMinWidth || mediaMaxWidth) {
    // Indent each line of the stylesheet
    const indented = stylesheet
      .split("\n")
      .map((line) => (line ? "  " + line : line))
      .join("\n");
    if (mediaMinWidth && mediaMaxWidth) {
      stylesheet = `@media (width >= ${mediaMinWidth}px) and (width < ${mediaMaxWidth}px) {\n${indented}}\n`;
    } else if (mediaMinWidth) {
      stylesheet = `@media (width >= ${mediaMinWidth}px) {\n${indented}}\n`;
    } else {
      // mediaMaxWidth
      stylesheet = `@media (width < ${mediaMaxWidth}px) {\n${indented}}\n`;
    }
  }
  return stylesheet;
}

export function replaceVariables(styleSheet) {
  const { css: cssReplaced } = postcss([postcssVarReplace()]).process(
    styleSheet
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

export function toStyleJSON(styleSheet) {
  const root = postcss.parse(styleSheet);
  const result = {};

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
