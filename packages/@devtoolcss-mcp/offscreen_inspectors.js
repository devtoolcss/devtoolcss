import { Inspector } from "chrome-inspector";
import { BiWeakNodeMap } from "./BiWeakNodeMap";
import { truncateHTML } from "./htmlUtils";
import { filterMatchedStyles, toStyleSheetText } from "./styleUtils";
import { evaluateDOMExpression } from "./DOMExpression";

// Create a chromeDebugger wrapper that works in offscreen context
async function sendDebuggerMessage(payload) {
  const response = await chrome.runtime.sendMessage({
    receiver: "background",
    ...payload,
  });

  if (response?.error) {
    throw new Error(response.error);
  } else {
    return response?.result;
  }
}

const chromeDebugger = {
  // Event listeners storage
  _listeners: new Set(),

  async attach(target, version) {
    return sendDebuggerMessage({
      event: "DEBUGGER_ATTACH",
      target,
    });
  },

  async detach(target) {
    return sendDebuggerMessage({
      event: "DEBUGGER_DETACH",
      target,
    });
  },

  // Send command to the actual chrome.debugger in background.js
  async sendCommand(target, method, params) {
    return sendDebuggerMessage({
      event: "DEBUGGER_SEND_COMMAND",
      target,
      method,
      params,
    });
  },

  onEvent: {
    addListener(callback) {
      chromeDebugger._listeners.add(callback);
    },
    removeListener(callback) {
      chromeDebugger._listeners.delete(callback);
    },
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

// record $0 xpaths for tabs not having inspector yet
const tab$0Map = new Map();

async function getInspector(tabId) {
  if (!inspectors[tabId]) {
    await chromeDebugger.attach({ tabId }, "1.3");
    inspectors[tabId] = await Inspector.fromChromeDebugger(
      chromeDebugger,
      tabId,
      { $0XPath: tab$0Map.get(tabId) },
    );
  }
  return inspectors[tabId];
}

const biMap = new BiWeakNodeMap();

// handling predefined nodes
function getNode(uid, inspector) {
  if (uid === "document") return inspector.document;
  if (uid === "$0") return inspector.$0;
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

async function processRequest(request) {
  console.log("processRequest - request:", request);
  const inspector = await getInspector(request.tabId);
  switch (request.tool) {
    case "getNodes": {
      // Unified node retrieval using DOM expression syntax
      if (!request.expression) {
        throw new Error("Missing 'expression' parameter");
      }
      return await evaluateDOMExpression(
        request.expression,
        inspector,
        getNode,
        biMap.set.bind(biMap),
      );
    }

    case "getMatchedStyles": {
      const {
        uid,
        removeUnusedVar = true,
        appliedOnly = false,
        filter,
      } = request;
      const node = getNode(uid, inspector);
      if (!node) {
        throw new Error(`Node not found for uid: ${uid}`);
      }
      const options = {
        parseOptions: { removeUnusedVar },
      };
      let styles = await node.getMatchedStyles(options);

      // Apply filters to reduce response size
      if (filter) {
        styles = filterMatchedStyles(styles, filter);
      }
      const toStyleSheetOptions = {
        applied: appliedOnly ? false : true,
        matchedSelectors: true,
      };
      const styleSheetText = toStyleSheetText(
        styles,
        node,
        toStyleSheetOptions,
      );
      console.log("serveRequest - getMatchedStyles styles:", styleSheetText);

      return { styles: styleSheetText };
    }

    case "getComputedStyle": {
      const node = getNode(request.uid, inspector);
      if (!node) {
        throw new Error("Node not found for uid: " + request.uid);
      }

      const styles = await node.getComputedStyle();
      const filtered = {};
      request.properties.map((prop) => {
        filtered[prop] = styles[prop];
      });
      console.log("serveRequest - getComputedStyle styles:", filtered);
      return { styles: filtered };
    }

    case "getOuterHTML": {
      // some safe defaults
      const {
        uid,
        maxDepth = 3,
        maxLineLength = 1000,
        maxChars = 500000,
      } = request;
      const node = getNode(uid, inspector);
      if (!node) {
        throw new Error(`Node not found for uid: ${uid}`);
      } else if (!node.tracked) {
        throw new Error(`Node is no longer existed for uid: ${uid}`);
      }
      // Apply depth and line length controls if provided
      const html = truncateHTML(
        node._docNode,
        maxDepth,
        maxLineLength,
        maxChars,
      );
      console.log("serveRequest - getOuterHTML html:", html);
      return { outerHTML: html };
    }

    default:
      throw new Error("Unknown tool: " + request.tool);
  }
}

// listener must be sync, return true to indicate async response
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.receiver !== "offscreen") return;

  switch (msg.event) {
    case "TAB_CLOSED":
      if (inspectors[msg.tabId]) {
        chromeDebugger.detach({ tabId: msg.tabId });
        delete inspectors[msg.tabId];
        biMap.cleanUp();
      }
      break;

    case "DEBUGGER_DETACHED":
      if (inspectors[msg.tabId]) {
        delete inspectors[msg.tabId];
        biMap.cleanUp();
        console.log(
          `Inspector for tab ${msg.tabId} detached for ${msg.reason}`,
        );
      }
      break;

    case "DEBUGGER_EVENT":
      const { source, method, params } = msg;
      chromeDebugger._dispatchEvent(source, method, params);
      break;

    case "SET_INSPECTED_TAB_$0":
      tab$0Map.set(msg.tabId, msg.xpath);
      break;

    case "REQUEST":
      processRequest(msg.request)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || String(error) });
        });
      return true; // Keep the message channel open for async response
  }
});
