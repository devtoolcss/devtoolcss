import { Inspector } from "chrome-inspector";
import { BiWeakNodeMap } from "./BiWeakNodeMap";
import { truncateHTML } from "./htmlUtils";
import {
  filterComputedStyle,
  filterMatchedStyles,
  simplifyMatchedStyles,
} from "./styleUtils";
import { evaluateDOMExpression } from "./DOMExpression";

// Create a chromeDebugger wrapper that works in offscreen context
const chromeDebugger = {
  // Event listeners storage
  _listeners: new Set(),

  async attach(target, version, callback = () => {}) {
    chrome.runtime.sendMessage(
      {
        type: "DEBUGGER_ATTACH",
        target,
      },
      (response) => {
        if (response?.error) {
          throw new Error(response.error);
        }
        callback();
      },
    );
  },

  async detach(target, callback = () => {}) {
    chrome.runtime.sendMessage(
      {
        type: "DEBUGGER_DETACH",
        target,
      },
      (response) => {
        if (response?.error) {
          throw new Error(response.error);
        }
        callback();
      },
    );
  },

  onEvent: {
    addListener(callback) {
      chromeDebugger._listeners.add(callback);
    },
    removeListener(callback) {
      chromeDebugger._listeners.delete(callback);
    },
  },

  // Send command to the actual chrome.debugger in background.js
  async sendCommand(target, method, params) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "DEBUGGER_SEND_COMMAND",
          target,
          method,
          params,
        },
        (response) => {
          if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response?.result);
          }
        },
      );
    });
  },

  // Internal method to dispatch events to listeners
  _dispatchEvent(source, method, params) {
    for (const listener of chromeDebugger._listeners) {
      try {
        listener(source, method, params);
      } catch (e) {
        console.error("Error in debugger event listener:", e);
      }
    }
  },
};

// inspector management per tab
const inspectors = {};

async function getInspector(tabId) {
  if (!inspectors[tabId]) {
    await chromeDebugger.attach({ tabId }, "1.3");
    inspectors[tabId] = await Inspector.fromChromeDebugger(
      chromeDebugger,
      tabId,
    );
  }
  return inspectors[tabId];
}

const biMap = new BiWeakNodeMap();

// handling predefined nodes
function getNode(uid, inspector) {
  if (uid === "document") return inspector.document;
  return biMap.getNode(uid);
}

/**
 * Evaluates a DOM expression by replacing UID variables with actual nodes
 * Examples:
 *   "html" -> predefined html element (querySelector('html'))
 *   "html.querySelectorAll('div.container')[0]" -> query from html
 *   "uid_1.querySelectorAll('span')[0]" -> query from node
 *   "uid_1.parentNode" -> get parent node
 *   "uid_1.children[1]" -> get second child
 *
 * @param {Inspector} inspector - The inspector instance
 * @param {string} expression - DOM expression to evaluate
 * @returns {Promise<{uids: string[]} | {error: string}>}
 */

async function serveRequest(request) {
  const inspector = await getInspector(request.tabId);
  switch (request.tool) {
    case "getNodes": {
      // Unified node retrieval using DOM expression syntax
      if (!request.expression) {
        return { error: "Missing 'expression' parameter" };
      }
      return await evaluateDOMExpression(
        request.expression,
        inspector,
        getNode,
        biMap.set.bind(biMap),
      );
    }

    case "getMatchedStyles": {
      const node = getNode(request.uid, inspector);
      if (!node) {
        return { error: "Node not found for uid: " + request.uid };
      }
      let styles = await node.getMatchedStyles(request.options || {});
      console.log("serveRequest - getMatchedStyles styles:", styles);

      // Apply filters to reduce response size
      if (request.filter) {
        styles = filterMatchedStyles(styles, request.filter);
      }

      // Optionally simplify the response
      if (request.simplify) {
        styles = simplifyMatchedStyles(styles);
      }

      return { styles };
    }

    case "getComputedStyle": {
      const node = getNode(request.uid, inspector);
      if (!node) {
        return { error: "Node not found for uid: " + request.uid };
      }

      let styles = await node.getComputedStyle(request.options || {});
      console.log("serveRequest - getComputedStyle styles:", styles);

      // Apply filters to reduce response size
      if (request.filter) {
        styles = filterComputedStyle(styles, request.filter);
      } else if (request.properties) {
        // Backward compatibility: support direct properties array
        styles = filterComputedStyle(styles, {
          properties: request.properties,
        });
      }

      return { styles };
    }

    case "outerHTML": {
      const node = getNode(request.uid, inspector);
      if (!node) {
        return { error: "Node not found for uid: " + request.uid };
      } else if (!node.tracked) {
        return {
          error: "Node is no longer existed for uid: " + request.uid,
        };
      }
      // Apply depth and line length controls if provided
      html = truncateHTML(
        node._docNode,
        request.maxDepth,
        request.maxLineLength,
        request.maxChars,
      );

      return { outerHTML: html };
    }

    default:
      return { error: "Unknown tool: " + request.tool };
  }
}

// listener must be sync, return true to indicate async response
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.event) {
    case "TAB_CLOSED":
      chromeDebugger.detach({ tabId: msg.tabId });
      delete inspectors[msg.tabId];
      biMap.cleanUp();
      break;

    case "DEBUGGER_EVENT":
      const { source, method, params } = msg;
      chromeDebugger._dispatchEvent(source, method, params);
      break;

    default: // request
      serveRequest(msg).then(sendResponse);
      return true; // Keep the message channel open for async response
  }
});
