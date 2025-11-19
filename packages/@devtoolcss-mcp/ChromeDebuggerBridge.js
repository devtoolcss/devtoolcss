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

// A chrome.debugger wrapper implemented in runtime.messaging for offscreen context
class ChromeDebuggerBridge {
  _listeners = new Set();

  constructor() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      switch (msg.event) {
        case "DEBUGGER_EVENT":
          const { source, method, params } = msg;
          this._dispatchEvent(source, method, params);
          break;
      }
    });
  }

  async attach(target, version) {
    return sendDebuggerMessage({
      event: "DEBUGGER_ATTACH",
      target,
    });
  }

  async detach(target) {
    return sendDebuggerMessage({
      event: "DEBUGGER_DETACH",
      target,
    });
  }

  // Send command to the actual chrome.debugger in background.js
  async sendCommand(target, method, params) {
    return sendDebuggerMessage({
      event: "DEBUGGER_SEND_COMMAND",
      target,
      method,
      params,
    });
  }

  onEvent = {
    addListener: (callback) => {
      this._listeners.add(callback);
    },
    removeListener: (callback) => {
      this._listeners.delete(callback);
    },
  };

  // Internal method to dispatch events to listeners
  _dispatchEvent(source, method, params) {
    for (const listener of this._listeners) {
      try {
        listener(source, method, params);
      } catch (e) {
        console.error("Error in debugger event listener:", e);
      }
    }
  }
}

// A chrome.debugger wrapper implemented in runtime.messaging for offscreen context
export const chromeDebugger = new ChromeDebuggerBridge();
