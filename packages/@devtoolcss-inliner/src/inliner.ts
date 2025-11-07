import postcss from "postcss";
import { postcssVarReplace } from "postcss-var-replace";
import * as CSSwhat from "css-what";
import type {
  ParsedCSS,
  ParsedCSSPropertyObject,
  ParsedCSSPropertyValue,
} from "@devtoolcss/parser";
import {
  Inspector,
  CDPNodeType,
  CDPNode,
  InspectorElement,
} from "chrome-inspector";
import { iterateParsedCSS, traverse } from "@devtoolcss/parser";
import { forciblePseudoClasses } from "./constants.js";
import {
  AriaExpandedOptimizer,
  PrunePsuedoElementOptimizer,
} from "./optimizers/index.js";

import type {
  CDPNodeWithId,
  ParsedCSSRulesObjValue,
  ParsedStyleSheetObjValue,
  ParsedCSSRules,
  InlineOptions,
} from "./types.js";
import {
  getNormalizedSuffix,
  toStyleSheet,
  hasNonFuncPseudoClass,
} from "./utils.js";
import type { Optimizer } from "./optimizers/optimizer.js";

function getRewrittenSelectors(
  idSelector: string,
  matchedSelectors: string[] | undefined,
): string[] {
  const rewrittenSelectors = new Set<string>();
  if (!matchedSelectors) {
    rewrittenSelectors.add(idSelector);
  } else {
    for (const matchedSelector of matchedSelectors) {
      const parsedSelector = CSSwhat.parse(matchedSelector)[0];
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

// TODO: check why outer not replaced
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

function rewriteSelectors(parsed: ParsedCSS, id: string): ParsedCSSRules {
  const rules: ParsedCSSRules = {};
  iterateParsedCSS(parsed, (values, matchedSelectors, context) => {
    const idSelector = `#${id}`;
    const rewrittenSelectors = getRewrittenSelectors(
      idSelector,
      matchedSelectors,
    );
    for (const rewrittenSelector of rewrittenSelectors) {
      if (!rules[rewrittenSelector]) rules[rewrittenSelector] = [];
      values.forEach((v) => {
        // exclude inherited non-variable properties
        if (v.name.startsWith("--") || context !== "inherited") {
          rules[rewrittenSelector].push(v);
        }
      });
    }
  });
  return rules;
}

function removeOrigins(parsed: ParsedCSS, originsToRemove: string[]): void {
  for (let i = parsed.matched.length - 1; i >= 0; --i) {
    if (originsToRemove.includes(parsed.matched[i].origin)) {
      parsed.matched.splice(i, 1);
    }
  }
}

function getInlineText(
  node: CDPNodeWithId,
  parsedCSSs: ParsedCSS[],
  mediaConditions: string[],
  optimizers: Optimizer[],
) {
  const mediaRules: ParsedStyleSheetObjValue = {};
  for (let i = 0; i < parsedCSSs.length; i++) {
    const parsed = parsedCSSs[i];
    removeOrigins(parsed, ["user-agent"]);
    const rules = rewriteSelectors(parsed, node.id!);
    for (const optimizer of optimizers) {
      optimizer.afterRewriteSelectors(node, rules);
    }
    const inlineRules = cascade(rules);

    mediaRules[mediaConditions[i]] = replaceVariables(inlineRules);
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

function initIdCSS(node: CDPNode): CDPNodeWithId {
  let id = `node-${node.nodeId}`;
  let hasId = false;

  if (node.attributes) {
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
  }
  node.id = id;
  node.css = [];
  return node as CDPNodeWithId;
}

function mergeTrees(roots: CDPNodeWithId[], nScreens: number): CDPNodeWithId {
  const mergedRoot = roots[0];
  console.log("merge node", mergedRoot);
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

  const nodeMap = new Map<number, CDPNodeWithId[]>();

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
  element: Element, // JSDOM or browser DOM
  cssAttr = "data-css",
  removeAttr = true,
) {
  // clean scripts/styles/links
  element.querySelectorAll("script, link, style").forEach((el) => el.remove());

  const elements = Array.from(element.querySelectorAll(`[${cssAttr}]`));
  elements.push(element); // include root element
  for (const el of elements) {
    const cssText = el.getAttribute(cssAttr);
    if (cssText) {
      const isStyleSheet = cssText.includes("{");
      if (isStyleSheet) {
        // inline style can contain variables and override resolved stylesheet
        (el as HTMLElement).removeAttribute("style");

        const styleEl = element.ownerDocument.createElement("style");
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

function buildNodeTree(
  cdpNode: CDPNodeWithId,
  document: Document,
): Node | null {
  let docNode: Node;

  switch (cdpNode.nodeType) {
    case CDPNodeType.ELEMENT_NODE:
      // iframe is safe because no children (not setting pierce)
      docNode = document.createElement(cdpNode.localName);

      if (Array.isArray(cdpNode.attributes)) {
        for (let i = 0; i < cdpNode.attributes.length; i += 2) {
          (docNode as HTMLElement).setAttribute(
            cdpNode.attributes[i],
            cdpNode.attributes[i + 1],
          );
        }
      }
      break;

    case CDPNodeType.TEXT_NODE:
      docNode = document.createTextNode(cdpNode.nodeValue || "");
      break;

    case CDPNodeType.COMMENT_NODE:
      docNode = document.createComment(cdpNode.nodeValue || "");
      break;

    default:
      return null;
  }

  // Recursively add children
  if (cdpNode.children) {
    for (const child of cdpNode.children) {
      const childNode = buildNodeTree(child, document);
      if (childNode) docNode.appendChild(childNode);
    }
  }
  return docNode;
}

function getFreezedCdpTree(cdpNode: CDPNode): CDPNodeWithId {
  const nodeWithId = initIdCSS({ ...cdpNode });
  nodeWithId.css = [];
  nodeWithId.children = [];
  for (const child of cdpNode.children || []) {
    nodeWithId.children.push(getFreezedCdpTree(child));
  }
  return nodeWithId;
}

async function getInlinedComponent(
  selector: string,
  inspector: Inspector,
  onProgress: (completed: number, total: number) => void = () => {},
  onError: (e: any) => void = () => {},
  options: InlineOptions = {},
): Promise<Element> {
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

  const optimizers = [
    new AriaExpandedOptimizer(),
    new PrunePsuedoElementOptimizer(),
  ];
  const freezedRoots = [];
  for (let i = 0; i < customScreens.length; ++i) {
    if (customScreens[i]) {
      await inspector.setDevice(customScreens[i]);
    }
    const root = inspector.querySelector(selector);
    for (const optimizer of optimizers) {
      await optimizer.beforeTraverse(root);
    }
    const freezedCdpRoot = getFreezedCdpTree(root._cdpNode);

    let total = 0;
    await traverse(
      freezedCdpRoot,
      async (freezedNode: CDPNodeWithId) => {
        total += 1;
      },
      onError,
      -1,
      false,
    );

    let completed = 0;
    await traverse(
      freezedCdpRoot,
      async (freezedNode: CDPNodeWithId) => {
        const inspectorElement = inspector.getNodeByNodeId(
          freezedNode.nodeId,
        ) as InspectorElement;
        if (highlightNode) {
          await inspectorElement.scrollIntoView();
          await inspector.highlightNode(inspectorElement);
        }

        for (const optimizer of optimizers) {
          await optimizer.beforeForcePseudo(inspectorElement);
        }

        await inspector.forcePseudoState(
          inspectorElement,
          forciblePseudoClasses,
        );

        for (const optimizer of optimizers) {
          await optimizer.afterForcePseudo(inspectorElement);
        }

        freezedNode.css[i] = await inspectorElement.getMatchedStyles({
          parseOptions: { removeUnusedVar: true },
        });
        await inspector.forcePseudoState(inspectorElement, []); // reset forced pseudo states
        onProgress(++completed, total);
      },
      onError,
      -1,
      false,
    );
    if (highlightNode) {
      await inspector.hideHighlight();
    }
    freezedRoots.push(freezedCdpRoot);
  }
  const root = mergeTrees(freezedRoots, customScreens.length);
  // after all node.id are set
  await traverse(
    root,
    (node) => {
      const styleText = getInlineText(
        node,
        node.css,
        mediaConditions,
        optimizers,
      );
      node.attributes.push("data-css", styleText);
    },
    onError,
    -1,
    true,
  );
  const docRoot = buildNodeTree(
    root,
    inspector.documentImpl.createHTMLDocument(),
  ) as Element;
  inlineStyle(docRoot);
  return docRoot;
}

export { getInlinedComponent };
