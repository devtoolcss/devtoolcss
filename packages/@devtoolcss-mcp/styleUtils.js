/**
 * Filters computed styles based on provided property names or patterns
 * @param {Object} styles - The computed styles object
 * @param {Object} filter - Filter options
 * @param {string[]} [filter.properties] - Specific property names to include
 * @param {string[]} [filter.patterns] - Regex patterns to match property names
 * @returns {Object} Filtered styles
 */
export function filterComputedStyle(styles, filter = {}) {
  if (!filter || (!filter.properties && !filter.patterns && !filter.exclude)) {
    return styles;
  }

  const result = {};

  // If specific properties are requested, only include those
  if (filter.properties && Array.isArray(filter.properties)) {
    for (const prop of filter.properties) {
      if (prop in styles) {
        result[prop] = styles[prop];
      }
    }
    return result;
  }

  // If patterns are provided, match property names
  let matchedProps = new Set();
  if (filter.patterns && Array.isArray(filter.patterns)) {
    const regexes = filter.patterns.map((pattern) => new RegExp(pattern));
    for (const prop in styles) {
      for (const regex of regexes) {
        if (regex.test(prop)) {
          matchedProps.add(prop);
          break;
        }
      }
    }
  } else {
    // No patterns, include all
    matchedProps = new Set(Object.keys(styles));
  }

  return result;
}

/**
 * Filters matched styles response to reduce size
 * @param {Object} matchedStyles - The matched styles object from chrome-inspector
 * @param {Object} filter - Filter options
 * @param {string[]} [filter.field] - Array of field types to include (e.g., ['inlineStyle', 'matchedCSSRules', 'inherited', 'pseudoElements'])
 * @param {string[]} [filter.selectors] - Regex pattern for selector matching
 * @param {string[]} [filter.properties] - Properties to include rules with matching properties
 * @returns {Object} Filtered matched styles
 */
export function filterMatchedStyles(matchedStyles, filter = {}) {
  if (!filter || Object.keys(filter).length === 0) {
    return matchedStyles;
  }

  // Compile regex patterns if provided
  const selectorRegexes = filter.selectors
    ? filter.selectors.map((pattern) => new RegExp(pattern))
    : null;

  if (filter.field) {
    const fieldsToInclude = new Set(filter.field);
    for (const key of Object.keys(matchedStyles)) {
      if (!fieldsToInclude.has(key)) {
        delete matchedStyles[key];
      }
    }
  }

  const filterRuleBySelectors = (rules) => {
    return rules.filter((rule) => {
      return selectorRegexes.some((regex) =>
        regex.test(rule.matchedSelectors.join(", ")),
      );
    });
  };

  if (filter.selectors) {
    if (matchedStyles.inherited) {
      for (const inheritedItem of matchedStyles.inherited) {
        inherited;
      }
    }
  }

  // TODO: fix logic

  return result;
}

/**
 * Simplifies matched styles to a more readable format
 * @param {Object} matchedStyles - The matched styles object
 * @returns {Object} Simplified styles object
 */
export function simplifyMatchedStyles(matchedStyles) {
  const simplified = {
    inline: {},
    matched: [],
    inherited: [],
  };

  // Extract inline styles
  if (matchedStyles.inlineStyle?.cssProperties) {
    for (const prop of matchedStyles.inlineStyle.cssProperties) {
      simplified.inline[prop.name] = prop.value;
    }
  }

  // Extract matched rules
  if (matchedStyles.matchedCSSRules) {
    for (const rule of matchedStyles.matchedCSSRules) {
      const ruleObj = {
        selector: rule.rule?.selectorList?.text || rule.rule?.selectorText,
        properties: {},
      };

      if (rule.rule?.style?.cssProperties) {
        for (const prop of rule.rule.style.cssProperties) {
          ruleObj.properties[prop.name] = prop.value;
        }
      }

      simplified.matched.push(ruleObj);
    }
  }

  // Extract inherited styles
  if (matchedStyles.inherited) {
    for (const inheritedItem of matchedStyles.inherited) {
      const inheritedObj = {
        from: inheritedItem.inlineStyle ? "inline" : "rules",
        properties: {},
      };

      if (inheritedItem.matchedCSSRules) {
        for (const rule of inheritedItem.matchedCSSRules) {
          if (rule.rule?.style?.cssProperties) {
            for (const prop of rule.rule.style.cssProperties) {
              inheritedObj.properties[prop.name] = prop.value;
            }
          }
        }
      }

      if (Object.keys(inheritedObj.properties).length > 0) {
        simplified.inherited.push(inheritedObj);
      }
    }
  }

  return simplified;
}
