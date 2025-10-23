import postcss from "postcss";
import { postcssVarReplace } from "postcss-var-replace";
import * as CSSwhat from "css-what";
import type { Node, Screen } from "@devtoolcss/inspector";
import type {
  ParsedCSS,
  ParsedCSSPropertyObject,
  ParsedCSSRules,
  ParsedCSSPropertyValue,
} from "@devtoolcss/parser";
import { Inspector, CDPNodeType } from "@devtoolcss/inspector";
import { iterateParsedCSS, traverse } from "@devtoolcss/parser";
import { forciblePseudoClasses } from "./constants.js";

type NodeWithId = Node & { id: string; children?: NodeWithId[] };

type ParsedCSSRulesObjValue = {
  [selector: string]: ParsedCSSPropertyObject;
};

type ParsedStyleSheetObjValue = {
  [mediaKey: string]: ParsedCSSRulesObjValue;
};

type InlineOptions = {
  highlightNode?: boolean;
  customScreens?: Screen[];
  mediaConditions?: string[];
};

function getNormalizedSuffix(parsedSelector: CSSwhat.Selector[]): string {
  const pseudoClasses = [];
  let pseudoElement = null;
  for (let i = parsedSelector.length - 1; i >= 0; --i) {
    const selector = parsedSelector[i];
    if (selector.type === "pseudo") {
      // type to PseudoSelector
      const pseudo = selector as CSSwhat.PseudoSelector;
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
      pseudoElement = "::" + (selector as CSSwhat.PseudoElement).name;
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

function hasNonFuncPseudoClass(parsedSelector: CSSwhat.Selector[]): boolean {
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

function removeIneffectivePseudoElem(
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

function getInlineText(
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

function setIdAttrs(node): NodeWithId {
  let id = `node-${node.nodeId}`;
  let hasId = false;
  /*
  if (!node.attributes) {
    const { attributes } = await DOM.getAttributes({
      nodeId: node.nodeId,
    });
    node.attributes = attributes;
  }
  */
  for (let i = 0; i < node.attributes.length; i += 2) {
    if (node.attributes[i] === "id") {
      id = node.attributes[i + 1];
      if (id.includes(":")) {
        // can break selector
        id = id.replace(/:/g, "-");
        node.attributes[i + 1] = id;
      }
      hasId = true;
      break;
    }
  }
  if (!hasId) {
    node.attributes.push("id", id);
  }
  node.id = id;
  return node;
}

function mergeTrees(roots: NodeWithId[], nScreens: number): NodeWithId {
  const mergedRoot = roots[0];
  // merge css, filling missing with display: none
  if (mergedRoot.nodeType === CDPNodeType.ELEMENT_NODE) {
    for (const root of roots.slice(1)) {
      for (let i = 0; i < nScreens; ++i) {
        if (root.css[i]) {
          mergedRoot.css[i] = root.css[i];
        }
      }
    }
    for (let i = 0; i < nScreens; ++i) {
      if (!mergedRoot.css[i]) {
        mergedRoot.css[i] = {
          inherited: [],
          attributes: [],
          matched: {},
          pseudoElementMatched: {},
          inline: [
            {
              name: "display",
              value: "none",
              important: false,
            },
          ],
        };
      }
    }
  }

  if (roots.length === 1) {
    // assume children inherits the display: none
    // can break if children have some CSS overriding
    return mergedRoot;
  }

  const nodeMap = new Map<number, NodeWithId[]>();

  for (const root of roots) {
    if (root.children) {
      for (const child of root.children) {
        if (!nodeMap.has(child.nodeId)) {
          nodeMap.set(child.nodeId, [child]);
        } else {
          nodeMap.get(child.nodeId).push(child);
        }
      }
    }
  }

  mergedRoot.children = [];
  for (const nodes of nodeMap.values()) {
    mergedRoot.children.push(mergeTrees(nodes, nScreens));
  }
  return mergedRoot;
}

function inlineStyle(
  document: Document, // JSDOM or browser DOM
  cssAttr = "data-css",
  removeAttr = true,
) {
  const elements = document.querySelectorAll(`[${cssAttr}]`);
  for (const el of elements) {
    const cssText = el.getAttribute(cssAttr);
    if (cssText) {
      const isStyleSheet = cssText.includes("{");
      if (isStyleSheet) {
        // inline style can contain variables and override resolved stylesheet
        (el as HTMLElement).removeAttribute("style");

        const styleEl = document.createElement("style");
        styleEl.textContent = cssText;
        // keep here for stringify and eval
        const noChildTags = [
          // void elements
          // https://developer.mozilla.org/en-US/docs/Glossary/Void_element
          "AREA",
          "BASE",
          "BR",
          "COL",
          "EMBED",
          "HR",
          "IMG",
          "INPUT",
          "LINK",
          "META",
          "PARAM",
          "SOURCE",
          "TRACK",
          "WBR",
          // some others
          "TEXTAREA",
          "IFRAME",
          "TITLE",
          "SCRIPT",
          "STYLE",
        ];
        if (noChildTags.includes(el.tagName) || el.children.length === 0) {
          // prevent break :empty for those with no children
          // still may break :nth-child()
          el.parentNode.insertBefore(styleEl, el);
        } else {
          el.insertBefore(styleEl, el.children[0]);
        }
      } else {
        // inline style
        // JSDOM CSSOM is buggy, directly set style attr
        (el as HTMLElement).setAttribute("style", cssText);
      }

      // cleanup attrs
      if (removeAttr) {
        Array.from(el.attributes).forEach((attr) => {
          if (attr.name === cssAttr) {
            el.removeAttribute(attr.name);
          }
        });
      }
    }
  }
}

async function getInlinedComponent(
  selector: string,
  inspector: Inspector,
  onError: (e: any) => void = () => {},
  options: InlineOptions,
): Promise<Document> {
  const { highlightNode = false } = options;
  let { customScreens, mediaConditions } = options;
  if (!customScreens) {
    customScreens = [undefined];
    mediaConditions = [""];
  } else if (mediaConditions.length !== customScreens.length) {
    throw Error(
      `mediaConditions.length should equal to customScreens.length. Got: ${mediaConditions.length} vs ${customScreens.length}`,
    );
  }

  const roots = [];
  for (let i = 0; i < customScreens.length; ++i) {
    const node = await inspector.inspect(selector, {
      depth: -1,
      parseOptions: { excludeOrigin: ["user-agent"], removeUnusedVar: true },
      customScreen: customScreens[i],
      beforeGetMatchedStyle: async (node, inspector) => {
        if (highlightNode) {
          const objectId = await inspector.getNodeObjectId(node);
          await inspector.scrollToNode(objectId);
          await inspector.highlightNode(objectId);
        }
        // force all pseudo classes
        await inspector.sendCommand("CSS.forcePseudoState", {
          nodeId: node.nodeId,
          forcedPseudoClasses: forciblePseudoClasses,
        });
      },
      afterGetMatchedStyle: async (node, inspector) => {
        // cleanup forced pseudo classes
        await inspector.sendCommand("CSS.forcePseudoState", {
          nodeId: node.nodeId,
          forcedPseudoClasses: [],
        });
        //console.log("cleaned forced pseudo classes for node", node.nodeId);
        if (highlightNode) {
          await inspector.hideHighlight();
        }
      },
    });
    // label css by screen idx
    await traverse(
      node,
      (n) => {
        const css = [];
        css[i] = n.css;
        n.css = css;
      },
      onError,
      -1,
      true,
    );
    roots.push(node);
  }
  const root = mergeTrees(roots, customScreens.length);
  await traverse(
    root,
    (node) => {
      setIdAttrs(node);
      const styleText = getInlineText(node, node.css, mediaConditions);
      node.attributes.push("data-css", styleText);
    },
    onError,
    -1,
    true,
  );
  const doc = Inspector.nodeToDOM(root);
  inlineStyle(doc);
  return doc;
}

export { InlineOptions, getInlinedComponent };
