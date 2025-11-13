import { Inspector } from "chrome-inspector";
import { BiWeakNodeMap } from "./BiWeakNodeMap";
import { truncateHTML } from "./htmlUtils";
import {
  filterComputedStyle,
  filterMatchedStyles,
  simplifyMatchedStyles,
} from "./styleUtils";

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

const biMap = new BiWeakNodeMap();

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

async function serveRequest(request) {
  const inspector = await getInspector(request.tabId);
  switch (request.tool) {
    case "querySelectorAll": {
      const nodes = await inspector.querySelectorAll(request.selector);
      const uids = nodes.map((node) => biMap.set(node));
      return { uids: uids };
    }

    case "getMatchedStyles": {
      const node = biMap.getNode(request.uid);
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
      const node = biMap.getNode(request.uid);
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

    case "querySelectorAll_handle": {
      const node = biMap.getNode(request.uid);
      if (!node) {
        return { error: "Node not found for uid: " + request.uid };
      }
      const nodes = await node.querySelectorAll(request.selector);
      const uids = nodes.map((n) => biMap.set(n));
      return { uids };
    }

    case "parent": {
      const node = biMap.getNode(request.uid);
      if (!node) {
        return { error: "Node not found for uid: " + request.uid };
      }
      const parent = node.parentNode;
      if (!parent) {
        return { uid: null };
      }
      const uid = biMap.set(parent);
      return { uid };
    }

    case "children": {
      const node = biMap.getNode(request.uid);
      if (!node) {
        return { error: "Node not found for uid: " + request.uid };
      }
      const children = node.children || node.childNodes;
      const uids = children.map((child) => biMap.set(child));
      return { uids };
    }

    case "attributes": {
      const node = biMap.getNode(request.uid);
      if (!node) {
        return { error: "Node not found for uid: " + request.uid };
      }
      const attrs = {};
      if (node.attributes) {
        for (let i = 0; i < node.attributes.length; i++) {
          const attr = node.attributes[i];
          attrs[attr.name] = attr.value;
        }
      }
      return { attributes: attrs };
    }

    case "outerHTML": {
      const node = biMap.getNode(request.uid);
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
