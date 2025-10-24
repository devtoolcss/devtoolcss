import type { Protocol } from "devtools-protocol";

type RuleMatch = Protocol.CSS.RuleMatch;
type CSSStyle = Protocol.CSS.CSSStyle;
type GetMatchedStylesForNodeResponse =
  Protocol.CSS.GetMatchedStylesForNodeResponse;

import type {
  ParsedCSSRules,
  ParsedCSSPropertyValue,
  ParsedCSS,
  ParsedCSSPropertyObject,
} from "./types.js";

import inheritableProperties from "./inheritableProperties.js";

function isInheritableProperty(propName: string): boolean {
  return propName.startsWith("--") || inheritableProperties.includes(propName);
}

export type ParseOptions = {
  excludeOrigin?: string[];
  removeUnusedVar?: boolean;
};

export function parseCSSProperties(
  cssStyle: CSSStyle,
  appliedProperties: ParsedCSSPropertyObject = {}, // optional for tracking applied
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
    const value = prop.value.replace(/\s*!important\s*$/, "");

    // .longhandProperties not exist if first arg is var
    // padding: var(--lp-section-padding-top) var(--lp-section-padding-x) var(--lp-section-padding-bottom);
    // This is by blink's design, devtool also manually check it
    // https://github.com/ChromeDevTools/devtools-frontend/blob/f806ee3b25e02a31b71de20227a3b36b453bd695/front_end/core/sdk/CSSProperty.ts#L75
    // Current behavior will return all long-hands in CSSProperty, so we don't build lookup table,
    // but directly check whether it is in declared in cssText

    // explicit is having more than "name" and "value" fields
    console.log(prop, Object.keys(prop));
    const explicit = Object.keys(prop).length > 2;

    //const explicit = new RegExp(`(^|[^-])${prop.name}`).test(cssStyle.cssText);
    // failed when
    // {"name": "font-family", "value": "system-ui,sans-serif", "range": {}, ...}
    // ...
    // {"name": "font-family", "value": "system-ui, sans-serif"}

    const isDup =
      !prop.range && css.some((p) => p.name === prop.name && p.value === value);

    if (isDup) continue;

    const valueObj: ParsedCSSPropertyValue = {
      name: prop.name,
      value: value,
      important: Boolean(prop.important),
      inherited: inherited,
      explicit: explicit, //!longhandProperties.has(prop.name), //prop.explicit,
    };
    css.push(valueObj);

    const canOverride = (
      a: ParsedCSSPropertyValue,
      b: ParsedCSSPropertyValue,
    ): boolean => {
      // inherited properties can always be overridden without considering importance
      if (a.inherited) return true;

      // important has higher priority
      return !(a.important && !b.important);
    };

    if (
      !appliedProperties[prop.name] ||
      canOverride(appliedProperties[prop.name], valueObj)
    ) {
      appliedProperties[prop.name] = valueObj; // same obj for final checking applied
    }
  }
  return css;
}

function iterateRuleMatches(
  ruleMatches: RuleMatch[],
  appliedProperties: ParsedCSSPropertyObject,
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
      appliedProperties,
      inherited,
    );
    const selectorList = matchingSelectors.join(", ");
    // merge if same selectorList
    if (!parsedRules[selectorList]) parsedRules[selectorList] = properties;
    else parsedRules[selectorList].push(...properties);
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
      | "pseudoElementMatched"
      | "inline",
  ) => void,
) {
  for (const inheritedRules of parsed.inherited) {
    for (const [selector, rules] of Object.entries(inheritedRules)) {
      callback(rules, selector, "inherited");
    }
  }

  callback(parsed.attributes, undefined, "attributes");

  for (const [selector, rules] of Object.entries(parsed.matched)) {
    callback(rules, selector, "matched");
  }

  for (const pseudoRules of Object.values(parsed.pseudoElementMatched)) {
    for (const [selector, rules] of Object.entries(pseudoRules)) {
      callback(rules, selector, "pseudoElementMatched");
    }
  }

  callback(parsed.inline, undefined, "inline");
}

export function parseGetMatchedStylesForNodeResponse(
  response: GetMatchedStylesForNodeResponse,
  options: ParseOptions = {},
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
  const appliedProperties: ParsedCSSPropertyObject = {};

  if (inherited) {
    for (let i = inherited.length - 1; i >= 0; i--) {
      const inheritedStyle = inherited[i];
      const data = {};
      if (inheritedStyle.inlineStyle) {
        data["::inline"] = parseCSSProperties(
          inheritedStyle.inlineStyle,
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
    parsed.attributes = parseCSSProperties(attributesStyle, appliedProperties);
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
    parsed.inline = parseCSSProperties(inlineStyle, appliedProperties);
  }

  const removeImplicit = (values: ParsedCSSPropertyValue[]) => {
    for (let i = values.length - 1; i >= 0; i--) {
      if (!values[i].explicit) {
        values.splice(i, 1);
      }
    }
  };
  const cleanValues = (values: ParsedCSSPropertyValue[]) => {
    for (const value of values) {
      delete value.explicit;
      delete value.inherited;
    }
  };
  const markApplied = (values: ParsedCSSPropertyValue[]) => {
    for (const value of values) {
      value.applied = appliedProperties[value.name] === value;
    }
  };

  iterateParsedCSS(parsed, removeImplicit);
  iterateParsedCSS(parsed, cleanValues);
  iterateParsedCSS(parsed, markApplied);

  if (options.removeUnusedVar) {
    removeUnusedVariables(parsed);
  }

  return parsed;
}

function removeUnusedVariables(parsed: ParsedCSS) {
  const removedVariables: Set<string> = new Set();
  const varUses = new Map<string, number>();
  iterateParsedCSS(parsed, (values) => {
    for (const val of values) {
      if (val.value.includes("var("))
        varUses.set(val.value, (varUses.get(val.value) || 0) + 1);
    }
  });
  function removeUse(value: string) {
    if (!varUses.has(value)) return;
    const count = varUses.get(value)! - 1;
    if (count === 0) {
      varUses.delete(value);
    } else {
      varUses.set(value, count);
    }
  }

  let removed = false;
  do {
    removed = false;
    iterateParsedCSS(parsed, (values) => {
      for (let i = values.length - 1; i >= 0; i--) {
        const val = values[i];
        if (val.name.startsWith("--")) {
          if (removedVariables.has(val.name)) {
            removeUse(val.value);
            values.splice(i, 1);
            removed = true;
          } else {
            let used = false;
            for (const v of varUses.keys()) {
              if (v.includes(val.name)) {
                used = true;
                break;
              }
            }
            if (!used) {
              removeUse(val.value);
              values.splice(i, 1);
              removedVariables.add(val.name);
              removed = true;
            }
          }
        }
      }
    });
  } while (removed);
}
