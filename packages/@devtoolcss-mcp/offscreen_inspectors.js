import { Inspector } from "chrome-inspector";
import { BiWeakNodeMap } from "./BiWeakNodeMap";

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
    case "querySelectorAll":
      const nodes = await inspector.querySelectorAll(request.selector);
      const uids = nodes.map((node) => biMap.set(node));
      console.log("serveRequest - querySelectorAll uids:", uids);
      return { uids: uids };
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
