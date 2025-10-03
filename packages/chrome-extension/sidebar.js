/// <reference types="chrome"/>

import {
  traverse,
  cascade,
  cascadePseudoClass,
  inlineStyle,
  CDPNodeType,
  toStyleSheet,
  toStyleJSON,
  replaceVariables,
} from "@clonecss/cleanclone-core";

import { getUniqueSelector } from "./selector.js";

const pseudoClasses = [
  "active",
  "hover",
  "focus",
  "checked",
  "enabled",
  "disabled",
  "focus-within",
  "autofill",
  "target",
  "valid",
];

const target = { tabId: chrome.devtools.inspectedWindow.tabId };
const iframe = document.getElementById("previewFrame");

function inspectedWindowEval(f, argStr) {
  return new Promise((resolve, reject) =>
    chrome.devtools.inspectedWindow.eval(
      `${f.toString()}\n${f.name}(${argStr});`,
      (result, isException) => {
        if (isException) {
          reject(`inspectedWindowEval: Error executing ${f.name}(${argStr})`);
        } else {
          resolve(result);
        }
      },
    ),
  );
}

function toDOM(cdpRoot, setNodeId = false) {
  // Create a new HTMLDocument instead of using window.document
  const doc = document.implementation.createHTMLDocument("Cloned DOM");
  // Use the body as the root container
  const container = doc.body;

  const buildNode = (cdpNode, document) => {
    let node;

    switch (cdpNode.nodeType) {
      case CDPNodeType.ELEMENT_NODE:
        node = document.createElement(cdpNode.nodeName.toLowerCase());
        if (Array.isArray(cdpNode.attributes)) {
          for (let i = 0; i < cdpNode.attributes.length; i += 2) {
            node.setAttribute(cdpNode.attributes[i], cdpNode.attributes[i + 1]);
          }
        }
        if (setNodeId) {
          node.setAttribute("data-nodeId", cdpNode.nodeId);
        }
        break;

      case CDPNodeType.TEXT_NODE:
        node = document.createTextNode(cdpNode.nodeValue || "");
        break;

      case CDPNodeType.COMMENT_NODE:
        node = document.createComment(cdpNode.nodeValue || "");
        break;

      case CDPNodeType.DOCUMENT_NODE:
        // Skip creating a document node, just process children
        return null;

      case CDPNodeType.DOCUMENT_TYPE_NODE:
        return null;

      default:
        console.warn("buildNode: unsupported node type");
        return null;
    }

    // Recursively add children
    if (cdpNode.children) {
      for (const child of cdpNode.children) {
        const childNode = buildNode(child, document);
        if (childNode) node.appendChild(childNode);
      }
    }

    return node;
  };

  const domRoot = buildNode(cdpRoot, doc);
  if (domRoot) {
    container.appendChild(domRoot);
  }
  return doc;
}

function mergeStyles(
  node,
  screens = [{ width: 1024, height: 800, mobile: false }],
) {
  const styleJSONs = {};
  Object.entries(node.css || {}).forEach(([screenKey, rules]) => {
    styleJSONs[screenKey] = toStyleJSON(replaceVariables(toStyleSheet(rules)));
  });
  const sharedCSS = {};
  const [firstStyleJSON, ...otherStyleJSONs] = Object.values(styleJSONs);
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
          Object.values(styleJSONs).forEach((styleJSON) => {
            if (styleJSON[targetSelector])
              delete styleJSON[targetSelector][targetProp];
          });
        }
      }
      for (const screenKey of Object.keys(styleJSONs)) {
        const styleKeyJSON = styleJSONs[screenKey];
        for (const selector of Object.keys(styleKeyJSON))
          if (Object.keys(styleKeyJSON[selector]).length === 0)
            delete styleKeyJSON[selector];
        if (Object.keys(styleJSONs[screenKey]).length === 0)
          delete styleJSONs[screenKey];
      }
    }
  }
  let style = "";
  if (
    Object.keys(styleJSONs).length === 0 &&
    Object.keys(sharedCSS).length === 0
  )
    return;
  else if (
    Object.keys(styleJSONs).length === 0 &&
    Object.keys(sharedCSS).length === 1 &&
    Object.keys(sharedCSS)[0] === `#${node.id}`
  ) {
    for (const [key, value] of Object.entries(sharedCSS[`#${node.id}`])) {
      style += `${key}: ${value.value}${
        value.important ? " !important" : ""
      }; `;
    }
  } else {
    if (Object.keys(sharedCSS).length > 0) style += toStyleSheet(sharedCSS);
    for (const key of Object.keys(styleJSONs)) {
      const i = parseInt(key);
      if (i === 0)
        style += toStyleSheet(styleJSONs[i], null, this.cfg.breakpoints[i]);
      else if (i === screens.length - 1)
        style += toStyleSheet(styleJSONs[i], this.cfg.breakpoints[i - 1], null);
      else
        style += toStyleSheet(
          styleJSONs[i],
          this.cfg.breakpoints[i - 1],
          this.cfg.breakpoints[i],
        );
    }
  }
  node.attributes.push("data-css", style);
}

async function setIdAttrs(node) {
  let id = `node-${node.nodeId}`;
  let hasId = false;
  if (!node.attributes) {
    const { attributes } = await DOM.getAttributes({
      nodeId: node.nodeId,
    });
    node.attributes = attributes;
  }
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
}

async function clone(root) {
  const deviceIndex = 0;

  let totalElements = 0;
  const initElements = async (node) => {
    await setIdAttrs(node);
    node.css = {};
    totalElements += 1;
  };
  await traverse(root, initElements, console.error, true);

  let processed = 0;
  await traverse(
    root,
    async (node) => {
      const styles = await chrome.debugger.sendCommand(
        target,
        "CSS.getMatchedStylesForNode",
        {
          nodeId: node.nodeId,
        },
      );
      node.css[deviceIndex] = {
        ...node.css[deviceIndex],
        ...cascade(node, styles),
      };
      processed += 1;
    },
    console.error,
    true,
  );

  const doc = toDOM(root, true);
  const checkChildrenNodeIds = new Set();
  try {
    doc.querySelectorAll("li:has([aria-expanded])").forEach((el) => {
      checkChildrenNodeIds.add(Number(el.attributes["data-nodeId"].value));
    });
  } catch {}
  processed = 0;
  await traverse(
    root,
    async (node) => {
      // collect styles
      const checkChildren =
        checkChildrenNodeIds.has(node.nodeId) && node.children;
      const childrenStyleBefore = [];
      const childrenStyleAfter = [];

      if (checkChildren) {
        // use for loop to await, forEach will not
        for (let i = 0; i < node.children.length; ++i) {
          const child = node.children[i];

          const childrenStyle = await chrome.debugger.sendCommand(
            target,
            "CSS.getMatchedStylesForNode",
            {
              nodeId: child.nodeId,
            },
          );
          childrenStyleBefore.push(childrenStyle);
        }
      }

      await chrome.debugger.sendCommand(target, "CSS.forcePseudoState", {
        nodeId: node.nodeId,
        forcedPseudoClasses: pseudoClasses,
      });

      const styles = await chrome.debugger.sendCommand(
        target,
        "CSS.getMatchedStylesForNode",
        {
          nodeId: node.nodeId,
        },
      );

      if (checkChildren) {
        for (let i = 0; i < node.children.length; ++i) {
          const child = node.children[i];
          const childrenStyle = await chrome.debugger.sendCommand(
            target,
            "CSS.getMatchedStylesForNode",
            {
              nodeId: child.nodeId,
            },
          );
          childrenStyleAfter.push(childrenStyle);
        }
      }

      await chrome.debugger.sendCommand(target, "CSS.forcePseudoState", {
        nodeId: node.nodeId,
        forcedPseudoClasses: [],
      });

      const pseudoCss = cascadePseudoClass(
        node,
        styles,
        childrenStyleBefore,
        childrenStyleAfter,
      );

      //console.log("pseudoCss", pseudoCss);

      node.css[deviceIndex] = {
        ...node.css[deviceIndex],
        ...pseudoCss,
      };
      //console.log("node.css", node.css[i]);

      processed += 1;
    },
    console.error,
    false,
  );

  function cleanUp(node) {
    for (const rulesObj of Object.values(node.css || {})) {
      for (const [selector, rules] of Object.entries(rulesObj)) {
        for (const [prop, value] of Object.entries(rules)) {
          if (!value.explicit) {
            delete rules[prop];
          } else {
            delete value.explicit;
          }
        }
      }
    }
  }

  await traverse(
    root,
    (node) => {
      cleanUp(node);
    },
    console.error,
    true,
  );

  await traverse(
    root,
    (node) => {
      mergeStyles(node);
    },
    console.error,
    true,
  );
  const finalDoc = toDOM(root, false);
  inlineStyle(finalDoc, "data-css", true);
  return finalDoc;
}

async function getChildren(node) {
  const childrenPromise = new Promise((resolve) => {
    // if no children to request, also good
    const timeoutId = setTimeout(() => {
      chrome.debugger.onEvent.addListener(handler);
      resolve();
    }, 500);

    let handler;
    handler = (source, method, params) => {
      if (method !== "DOM.setChildNodes" || node.nodeId !== params.parentId)
        return;
      node.children = params.nodes;
      chrome.debugger.onEvent.removeListener(handler);
      clearTimeout(timeoutId);
      resolve();
    };

    chrome.debugger.onEvent.addListener(handler);
  });
  await chrome.debugger.sendCommand(target, "DOM.requestChildNodes", {
    nodeId: node.nodeId,
    depth: -1,
  });
  await childrenPromise;
}

const exportBtn = document.getElementById("exportBtn");

(async () => {
  exportBtn.onclick = async function () {
    // initialize CDP
    exportBtn.disabled = true;
    try {
      await chrome.debugger.attach(target, "1.3");
      await chrome.debugger.sendCommand(target, "DOM.enable");
      await chrome.debugger.sendCommand(target, "CSS.enable");

      const selector = await inspectedWindowEval(getUniqueSelector, "$0");
      const { root } = await chrome.debugger.sendCommand(
        target,
        "DOM.getDocument",
        { depth: 0 },
      );
      const { nodeId } = await chrome.debugger.sendCommand(
        target,
        "DOM.querySelector",
        { nodeId: root.nodeId, selector },
      );
      const { node } = await chrome.debugger.sendCommand(
        target,
        "DOM.describeNode",
        {
          nodeId,
          depth: 1, // so that #text will also be retrived
        },
      );
      // depth 1 doesn't matter, it will return the same node with the
      // same children even though included before.
      await getChildren(node);

      const doc = await clone(node);
      // must set DOCTYPE otherwise svg without xmlns will not render
      iframe.contentDocument.body.innerHTML = doc.body.innerHTML;

      await chrome.debugger.detach(target);
    } catch (e) {
      console.error(e instanceof Error ? e.message + "\n" + e.stack : e);
      await chrome.debugger.detach(target);
    }
    exportBtn.disabled = false;
  };
})();
