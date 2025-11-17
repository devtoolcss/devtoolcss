/**
 * Filters matched styles response to reduce size
 * @param {Object} styles - The matched styles object from chrome-inspector
 * @param {Object} filter - Filter options
 * @param {string[]} [filter.selectors] - Regex pattern for selector matching in matched and pseudoElements
 * @param {string[]} [filter.properties] - Properties to include rules with matching properties
 * @param {boolean} [filter.appliedOnly] - If true, only include applied properties
 * @returns {Object} Filtered matched styles
 */
export function filterMatchedStyles(styles, filter) {
  // Compile regex patterns if provided

  if (filter.selectors) {
    const selectorRegexes = filter.selectors
      ? filter.selectors.map((pattern) => new RegExp(pattern))
      : null;
    const filterRulesBySelectors = (rules) => {
      return rules.filter((rule) => {
        return selectorRegexes.some((regex) =>
          regex.test(rule.matchedSelectors.join(", ")),
        );
      });
    };
    styles.matchedCSSRules = filterRulesBySelectors(styles.matchedCSSRules);
    styles.pseudoElements = filterRulesBySelectors(styles.pseudoElements);
  }

  const filterAllProperties = (styles, filter) => {
    const filterProperties = (properties) => {
      return properties.filter(filter);
    };
    for (const parentCSS of styles.inherited) {
      parentCSS.inline = filterProperties(parentCSS.inline);
      for (const rule of parentCSS.matched) {
        rule.properties = filterProperties(rule.properties);
      }
    }
    styles.attributes = filterProperties(styles.attributes);
    for (const rule of styles.matchedCSSRules) {
      rule.properties = filterProperties(rule.properties);
    }
    for (const rule of styles.pseudoElements) {
      rule.properties = filterProperties(rule.properties);
    }
    styles.inline = filterProperties(styles.inline);
  };

  if (filter.properties) {
    const propertiesSet = new Set(filter.properties);
    const filter = (decl) => propertiesSet.has(decl.name);
    filterAllProperties(styles, filter);
  }

  if (filter.appliedOnly) {
    const filter = (decl) => decl.applied === true;
    filterAllProperties(styles, filter);
  }

  return styles;
}

export function toStyleSheetText(styles, element, commentConfig = {}) {
  let cssText = "";

  const toCSSRuleText = (rule) => {
    const allSelectorsStr = rule.allSelectors.join(", ");
    const matchedSelectorsStr = rule.matchedSelectors.join(", ");
    let css = "";
    // TODO: inspector need CSS.styleSheetAdded event to get origin info
    //if (commentConfig.origin && rule.origin) {
    //  css += `/* Origin: ${rule.origin} */\n`;
    //}
    if (
      commentConfig.matchedSelectors &&
      matchedSelectorsStr !== allSelectorsStr
    ) {
      css += `/* Matched: ${matchedSelectorsStr} */\n`;
    }
    css += `${allSelectorsStr} {\n`;
    for (const prop of rule.properties) {
      css += `  ${prop.name}: ${prop.value};`;
      if (commentConfig.applied && prop.applied) {
        css += ` /* applied */`;
      }
      css += "\n";
    }
    css += `}\n\n`;
    return css;
  };

  // inline
  if (styles.inline.length > 0) {
    cssText += toCSSRuleText({
      allSelectors: ["element.style"],
      matchedSelectors: ["element.style"],
      properties: styles.inline,
    });
  }

  // matched & pseudoElements
  const allMatchedRules = [
    ...styles.matched,
    ...styles.pseudoElements,
  ].reverse();

  for (const rule of allMatchedRules) {
    if (rule.properties.length > 0) cssText += toCSSRuleText(rule);
  }

  // attributes
  if (styles.attributes.length > 0) {
    const selectorPlaceholder = `${element.nodeName.toLowerCase()}[Attributes Style]`;
    cssText += toCSSRuleText({
      allSelectors: [selectorPlaceholder],
      matchedSelectors: [selectorPlaceholder],
      properties: styles.attributes,
    });
  }

  for (const parentCSS of styles.inherited) {
    const { inline, matched, distance } = parentCSS;
    if (
      inline.length === 0 &&
      matched.every((rule) => rule.properties.length === 0)
    )
      continue;

    const getParentSelector = (element, distance) => {
      let parentNode = element;
      for (let i = 0; i < distance; i++) {
        parentNode = parentNode.parentNode;
      }
      let parentSelector = parentNode.nodeName.toLowerCase();
      if (parentNode.id) {
        parentSelector += `#${parentNode.id}`;
      } else if (parentNode.classList && parentNode.classList.length > 0) {
        parentSelector += `.${[...parentNode.classList].slice(0, 3).join(".")}`;
      }
      return parentSelector;
    };
    cssText += `/* Inherited from ${getParentSelector(element, distance)} */\n`;

    if (inline.length > 0) {
      cssText += toCSSRuleText({
        allSelectors: ["style attribute"],
        matchedSelectors: ["style attribute"],
        properties: inline,
      });
    }
    for (const rule of matched) {
      if (rule.properties.length > 0) {
        cssText += toCSSRuleText(rule);
      }
    }
  }
  return cssText;
}
