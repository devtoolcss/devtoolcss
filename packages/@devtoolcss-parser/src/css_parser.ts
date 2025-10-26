// use a version of devtools-protocol types for developer convenience
import type { Protocol } from "devtools-protocol";

type RuleMatch = Protocol.CSS.RuleMatch;
type CSSStyle = Protocol.CSS.CSSStyle;
type GetMatchedStylesForNodeResponse =
  Protocol.CSS.GetMatchedStylesForNodeResponse;

import type {
  ParsedCSSRule,
  ParsedCSSPropertyValue,
  ParsedCSS,
  ParsedCSSPropertyObject,
  ParseOptions,
} from "./types.js";

import inheritableProperties from "./inheritableProperties.js";

import { shorthandMap } from "./shorthands.js";

function isInheritableProperty(propName: string): boolean {
  return propName.startsWith("--") || inheritableProperties.includes(propName);
}

function addShortHands(
  cssStyle: CSSStyle,
  css: ParsedCSSPropertyValue[],
  inherited: boolean,
) {
  for (const { name, value, important } of cssStyle.shorthandEntries) {
    if (shorthandMap[name] === undefined) continue;

    for (let i = 0; i < css.length; i++) {
      if (shorthandMap[name].includes(css[i].name)) {
        const n = shorthandMap[name].length;
        const allExplicit = css.slice(i, i + n).every((p) => p.explicit);
        if (!allExplicit) continue; // already marked to implicit
        const names = css
          .slice(i, i + n)
          .map((p) => p.name)
          .sort();
        // array equality check
        if (
          JSON.stringify(names) ===
          JSON.stringify(shorthandMap[name].slice().sort())
        ) {
          for (let j = i; j < i + n; j++) {
            css[j].explicit = false;
          }
          // add shorthand entry
          css.splice(i, 0, {
            name,
            value: value.replace(/\s*!important\s*$/, ""),
            important: Boolean(important),
            inherited: inherited,
            explicit: true,
          });
          i += n; // skip longhands, later i++ will skip shorthand
        }
      }
    }
  }
}

export function parseCSSProperties(
  cssStyle: CSSStyle,
  appliedProperties: ParsedCSSPropertyObject = {}, // optional for tracking applied
  inherited: boolean = false,
): ParsedCSSPropertyValue[] {
  // For user-agent or injected styles (no .styleSheetId), we cannot determine explicit
  // or not by fields because they always only have "name" and "value" fields. Worse,
  // their properties only contain longhands, and shorthands are in .shorthandEntries
  // Devtool workaround this by heuristically grouping longhands to shorthands
  // https://github.com/ChromeDevTools/devtools-frontend/blob/d5701ce7eb7f0dcdeafdf322762a4afcf13cafaf/front_end/core/sdk/CSSStyleDeclaration.ts#L128
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

    // explicit is having more than "name" and "value" fields, if styleSheetId exist
    const explicit = cssStyle.styleSheetId
      ? Object.keys(prop).length > 2
      : true;

    //const explicit = new RegExp(`(^|[^-])${prop.name}`).test(cssStyle.cssText);
    // failed when
    // {"name": "font-family", "value": "system-ui,sans-serif", "range": {}, ...}
    // ...
    // {"name": "font-family", "value": "system-ui, sans-serif"}

    const isDup =
      !explicit && css.some((p) => p.name === prop.name && p.value === value);

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
      if (a.inherited && !b.inherited) return true;

      // important has higher priority, also in inherited
      return !(a.important && !b.important);
    };

    if (
      !appliedProperties[prop.name] ||
      canOverride(appliedProperties[prop.name], valueObj)
    ) {
      appliedProperties[prop.name] = valueObj; // same obj for final checking applied
    }
  }

  if (!cssStyle.styleSheetId) {
    addShortHands(cssStyle, css, inherited);
  }

  return css;
}

function iterateRuleMatches(
  ruleMatches: RuleMatch[],
  appliedProperties: ParsedCSSPropertyObject,
  inherited: boolean,
): ParsedCSSRule[] {
  const parsedRules: ParsedCSSRule[] = [];
  for (const ruleMatch of ruleMatches) {
    const allSelectors = ruleMatch.rule.selectorList.selectors.map(
      (s) => s.text,
    );
    const matchedSelectors = ruleMatch.matchingSelectors.map(
      (i) => ruleMatch.rule.selectorList.selectors[i].text,
    );
    const properties = parseCSSProperties(
      ruleMatch.rule.style,
      appliedProperties,
      inherited,
    );
    parsedRules.push({
      allSelectors,
      matchedSelectors,
      properties,
      origin: ruleMatch.rule.origin,
      cssText: ruleMatch.rule.style.cssText,
    });
  }
  return parsedRules;
}

// Iterate all properties in ParsedCSS.
// Preserve property defined order, not considering important
export function iterateParsedCSS(
  parsed: ParsedCSS,
  callback: (
    properties: ParsedCSSPropertyValue[],
    matchedSelectors: string[] | undefined,
    context:
      | "inherited"
      | "attributes"
      | "matched"
      | "pseudoElementMatched"
      | "inline",
  ) => void,
) {
  for (const { inline, matched } of parsed.inherited) {
    callback(inline, undefined, "inherited");
    for (const rule of matched) {
      callback(rule.properties, rule.matchedSelectors, "inherited");
    }
  }

  callback(parsed.attributes, undefined, "attributes");

  for (const rule of parsed.matched) {
    callback(rule.properties, rule.matchedSelectors, "matched");
  }

  for (const rule of parsed.pseudoElements) {
    callback(rule.properties, rule.matchedSelectors, "matched");
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
    matched: [],
    pseudoElements: [],
    inline: [],
  };
  const appliedProperties: ParsedCSSPropertyObject = {};

  if (inherited) {
    // reverse order to have closest ancestor last
    for (let i = inherited.length - 1; i >= 0; i--) {
      const inheritedStyle = inherited[i];
      const data: ParsedCSS["inherited"][number] = {
        distance: i + 1,
        inline: [],
        matched: [],
      };
      if (inheritedStyle.matchedCSSRules) {
        const parsedRules = iterateRuleMatches(
          inheritedStyle.matchedCSSRules,
          appliedProperties,
          true,
        );
        for (let j = parsedRules.length - 1; j >= 0; j--) {
          if (parsedRules[j].properties.length === 0) {
            parsedRules.splice(j, 1);
          }
        }
        data.matched = parsedRules;
      }
      if (inheritedStyle.inlineStyle) {
        data.inline = parseCSSProperties(
          inheritedStyle.inlineStyle,
          appliedProperties,
          true,
        );
      }
      if (data.inline.length === 0 && data.matched.length === 0) {
        continue;
      }
      parsed.inherited.push(data);
    }
  }

  if (attributesStyle) {
    parsed.attributes = parseCSSProperties(attributesStyle, appliedProperties);
  }

  if (matchedCSSRules) {
    const parsedRules = iterateRuleMatches(
      matchedCSSRules,
      appliedProperties,
      false,
    );
    parsed.matched = parsedRules;
  }

  if (pseudoElements) {
    for (const match of pseudoElements) {
      const parsedRules = iterateRuleMatches(
        match.matches,
        appliedProperties,
        false,
      );
      parsed.pseudoElements[match.pseudoType] = parsedRules;
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

export function removeUnusedVariables(parsed: ParsedCSS) {
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
