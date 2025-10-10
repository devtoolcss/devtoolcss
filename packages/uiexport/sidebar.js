/// <reference types="chrome"/>

import {
  traverse,
  parseGetMatchedStylesForNodeResponse,
  getInlineText,
  inlineStyle,
  CDPNodeType,
  forciblePseudoClasses,
} from "@devtoolcss/parser";

import { getUniqueSelector } from "./selector.js";

const target = { tabId: chrome.devtools.inspectedWindow.tabId };
const iframe = document.getElementById("previewFrame");
const progressBarContainer = document.getElementById("exportProgressContainer");
const progressBar = document.getElementById("exportProgressBar");
const progressText = document.getElementById("exportProgressText");

function updateProgress(value, max = undefined) {
  progressBar.value = value;
  if (max !== undefined) progressBar.max = max;
  progressText.textContent = `${progressBar.value} / ${progressBar.max}`;
}

function showProgress() {
  progressBarContainer.style.display = "block";
}

function hideProgress() {
  progressBarContainer.style.display = "none";
}

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

async function setIdAttrs(node) {
  let id = `node-${node.nodeId}`;
  let hasId = false;
  if (!node.attributes) {
    const { attributes } = await chrome.debugger.sendCommand(
      target,
      "DOM.getAttributes",
      {
        nodeId: node.nodeId,
      },
    );
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

  updateProgress(0, totalElements);

  const doc = toDOM(root, true);
  const checkChildrenNodeIds = new Set();
  /*
  try {
    doc.querySelectorAll("li:has([aria-expanded])").forEach((el) => {
      checkChildrenNodeIds.add(Number(el.attributes["data-nodeId"].value));
    });
  } catch {}
  */
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
        forcedPseudoClasses: forciblePseudoClasses,
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

      const parsedResponse = parseGetMatchedStylesForNodeResponse(styles, {
        excludeOrigin: ["user-agent"],
        removeUnusedVar: true,
      });
      const inlineText = getInlineText(node, [parsedResponse], [""]);
      if (inlineText) {
        node.attributes.push("data-css", inlineText);
      }

      updateProgress(progressBar.value + 1);
    },
    console.error,
    false,
  );

  const finalDoc = toDOM(root, false);
  inlineStyle(finalDoc, "data-css", true);
  return finalDoc;
}

async function getChildren(node) {
  const childrenPromise = new Promise((resolve) => {
    // if no children to request, also good
    const timeoutId = setTimeout(() => {
      chrome.debugger.onEvent.removeListener(handler);
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
    updateProgress(0, 1);
    showProgress();
    iframe.contentDocument.body.innerHTML = "";
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
    hideProgress();
  };
})();
