import { postcssVarReplace } from "postcss-var-replace";
import postcss from "postcss";

import type {
  ParsedCSSRules,
  RuleMatch,
  CSSStyle,
  ParsedCSSPropertyValue,
  GetMatchedStylesForNodeResponse,
  ParsedCSS,
  AppliedCSSProperty,
} from "./types.js";

import { inheritableProperties } from "./constants.js";

import type { PseudoElement, PseudoSelector, Selector } from "css-what";
import * as CSSwhat from "css-what";

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

function isInheritableProperty(propName: string): boolean {
  return propName.startsWith("--") || inheritableProperties.includes(propName);
}

export function parseCSSProperties(
  cssStyle: CSSStyle,
  selectors: string[],
  appliedProperties: AppliedCSSProperty,
  inherited: boolean = false,
): ParsedCSSPropertyValue[] {
  const css: ParsedCSSPropertyValue[] = [];
  for (const prop of cssStyle.cssProperties) {
    if (prop.disabled || prop.parsedOk === false) {
      // disable: commented property
      continue;
    }
    if (inherited && !isInheritableProperty(prop.name)) {
      // not inheritable property, skip
      continue;
    }
    //prop.explicit = Boolean(prop.range); // have false negative
    const value = prop.value.replace(/\s*!important\s*$/, "");

    // .longhandProperties not exist if first arg is var
    // padding: var(--lp-section-padding-top) var(--lp-section-padding-x) var(--lp-section-padding-bottom);
    // This is by blink's design, devtool also manually check it
    // https://github.com/ChromeDevTools/devtools-frontend/blob/f806ee3b25e02a31b71de20227a3b36b453bd695/front_end/core/sdk/CSSProperty.ts#L75
    // Current behavior will return all long-hands in CSSProperty, so we don't build lookup table,
    // but directly check whether it is in declared in cssText

    const explicit = new RegExp(`(^|[^-])${prop.name}`).test(cssStyle.cssText);
    const valueObj: ParsedCSSPropertyValue = {
      name: prop.name,
      value: value,
      important: Boolean(prop.important),
      explicit: explicit, //!longhandProperties.has(prop.name), //prop.explicit,
    };
    css.push(valueObj);

    const suffixes = new Set<string>();
    for (const selector of selectors) {
      const suffix = getNormalizedSuffix(CSSwhat.parse(selector)[0]);
      suffixes.add(suffix);
    }

    for (const suffix of suffixes) {
      if (
        !appliedProperties[suffix][prop.name] ||
        (!(appliedProperties[suffix][prop.name].important && !prop.important) &&
          // handle followed dup (bug?) without range (implicit)
          !(appliedProperties[suffix][prop.name].value === value && !explicit))
      ) {
        appliedProperties[suffix][prop.name] = valueObj; // same obj for final checking applied
      }
    }
  }
  return css;
}

function iterateRuleMatches(
  ruleMatches: RuleMatch[],
  appliedProperties: AppliedCSSProperty,
  excludeOrigin: string[] | undefined = undefined,
  inherited: boolean,
): ParsedCSSRules {
  const parsedRules: ParsedCSSRules = {};
  for (const ruleMatch of ruleMatches) {
    if (excludeOrigin?.includes(ruleMatch.rule.origin)) continue;
    const matchingSelectors = ruleMatch.matchingSelectors.map(
      (i) => ruleMatch.rule.selectorList.selectors[i].text,
    );
    const properties = parseCSSProperties(
      ruleMatch.rule.style,
      matchingSelectors,
      appliedProperties,
      inherited,
    );
    parsedRules[matchingSelectors.join(", ")] = properties;
  }
  return parsedRules;
}

export function iterateParsedCSS(
  parsed: ParsedCSS,
  callback: (
    values: ParsedCSSPropertyValue[],
    selectorList?: string, // can have multiple selectors separated by commas
    context?:
      | "inherited"
      | "attributes"
      | "matched"
      | "pseudoElement"
      | "inline",
  ) => void,
) {
  for (const inheritedRules of parsed.inherited) {
    for (const [selector, values] of Object.entries(inheritedRules)) {
      callback(values, selector, "inherited");
    }
  }

  callback(parsed.attributes, undefined, "attributes");

  for (const [selector, rules] of Object.entries(parsed.matched)) {
    callback(rules, selector, "matched");
  }

  for (const pseudoRules of Object.values(parsed.pseudoElementMatched)) {
    for (const [selector, rules] of Object.entries(pseudoRules)) {
      callback(rules, selector, "pseudoElement");
    }
  }

  callback(parsed.inline, undefined, "inline");
}

export function parseGetMatchedStylesForNodeResponse(
  response: GetMatchedStylesForNodeResponse,
  options: { excludeOrigin?: string[]; replaceVariable?: boolean } = {},
) {
  const {
    inherited,
    inlineStyle,
    attributesStyle,
    matchedCSSRules,
    pseudoElements,
  } = response;

  const parsed: ParsedCSS = {
    inherited: [],
    attributes: [],
    matched: {},
    pseudoElementMatched: {},
    inline: [],
  };
  const appliedProperties: AppliedCSSProperty = {};

  if (inherited) {
    for (let i = inherited.length - 1; i >= 0; i--) {
      const inheritedStyle = inherited[i];
      const data = {};
      if (inheritedStyle.inlineStyle) {
        data[":inline"] = parseCSSProperties(
          inheritedStyle.inlineStyle,
          [],
          appliedProperties,
          true,
        );
      }
      if (inheritedStyle.matchedCSSRules) {
        const parsedRules = iterateRuleMatches(
          inheritedStyle.matchedCSSRules,
          appliedProperties,
          options.excludeOrigin,
          true,
        );
        Object.assign(data, parsedRules);
      }
      parsed.inherited.push(data);
    }
    // closest first
    parsed.inherited.reverse();
  }

  if (attributesStyle) {
    parsed.attributes = parseCSSProperties(
      attributesStyle,
      [],
      appliedProperties,
    );
  }

  if (matchedCSSRules) {
    const parsedRules = iterateRuleMatches(
      matchedCSSRules,
      appliedProperties,
      options.excludeOrigin,
      false,
    );
    parsed.matched = parsedRules;
  }

  if (pseudoElements) {
    for (const match of pseudoElements) {
      const parsedRules = iterateRuleMatches(
        match.matches,
        appliedProperties,
        options.excludeOrigin,
        false,
      );
      parsed.pseudoElementMatched[match.pseudoType] = parsedRules;
    }
  }

  if (inlineStyle) {
    parsed.inline = parseCSSProperties(inlineStyle, [], appliedProperties);
  }

  const removeImplicit = (values: ParsedCSSPropertyValue[]) => {
    return values.filter((v) => v.explicit);
  };
  const markApplied = (
    values: ParsedCSSPropertyValue[],
    selectorList: string,
  ) => {
    const suffixes = CSSwhat.parse(selectorList).map((sel) =>
      getNormalizedSuffix(sel),
    );
    for (const value of values) {
      const { name } = value;
      value.applied = suffixes.some(
        (suffix) => appliedProperties[suffix][name] === value,
      );
    }
  };

  iterateParsedCSS(parsed, removeImplicit);
  iterateParsedCSS(parsed, markApplied);

  if (options.replaceVariable) {
    replaceVariables(parsed);
  }

  return parsed;
}

export function toStyleSheet(
  styleJSON: ParsedCSSRules,
  mediaCondition: string = "",
) {
  let stylesheet = "";
  for (const [selector, rules] of Object.entries(styleJSON)) {
    const decls = rules
      .map(
        (val) =>
          `${val.name}: ${val.value}${val.important ? " !important" : ""};`,
      )
      .join("");
    stylesheet += `${selector} {${decls}}`;
  }
  if (mediaCondition) {
    stylesheet = `@media ${mediaCondition} {${stylesheet}}`;
  }
  return stylesheet;
}

export function replaceVariables(parsed: ParsedCSS): void {
  const inheritedVariables: ParsedCSSPropertyValue[] = [];
  for (const rules of parsed.inherited) {
    for (const values of Object.values(rules)) {
      for (const val of values) {
        if (val.name.startsWith("--") && val.applied) {
          inheritedVariables.push(val);
        }
      }
    }
  }
  const styleSheet =
    toStyleSheet({ ":root": inheritedVariables }) +
    toStyleSheet({ ":inline": parsed.inline }) +
    toStyleSheet(parsed.matched) +
    Object.values(parsed.pseudoElementMatched)
      .map((rules) => toStyleSheet(rules))
      .join("");

  const { root } = postcss([postcssVarReplace()]).process(styleSheet);

  // Fixme: assume unique selector and property
  const replaced: { [selector: string]: { [prop: string]: string } } = {};
  root.walkRules((rule) => {
    const selector = rule.selector;
    if (!replaced[selector]) {
      replaced[selector] = {};
    }
    rule.walkDecls((decl) => {
      replaced[selector][decl.prop] = decl.value;
    });
  });
  const replaceVariablesRules = (parsedRules: ParsedCSSRules) => {
    for (const [selector, rules] of Object.entries(parsedRules)) {
      if (replaced[selector]) {
        for (const rule of rules) {
          // TODO: better var check
          if (rule.value.includes("var(") && replaced[selector][rule.name]) {
            rule.value = replaced[selector][rule.name];
          }
        }
      }
    }
  };
  replaceVariablesRules(parsed.matched);
  for (const pseudoRules of Object.values(parsed.pseudoElementMatched)) {
    replaceVariablesRules(pseudoRules);
  }
  replaceVariablesRules({ ":inline": parsed.inline });
}
