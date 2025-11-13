/// <reference types="chrome"/>

// Keep service worker alive
// https://stackoverflow.com/a/66618269
const KEEPALIVE_INTERVAL = 20000; // 20 seconds
const keepAlive = () =>
  setInterval(chrome.runtime.getPlatformInfo, KEEPALIVE_INTERVAL);
chrome.runtime.onStartup.addListener(keepAlive);
keepAlive();

// WebSocket connection state
let ws = null;
let settings = {
  host: "127.0.0.1",
  port: 9333,
  pollingEnabled: true,
  pollingInterval: 2000, // 2 seconds
};

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  return activeTab.id;
}

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  console.log(`Tab ${tabId} closed`);
  // Clean up any resources related to this tab
  chrome.runtime.sendMessage({
    event: "TAB_CLOSED",
    tabId: tabId,
  });
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  // Forward debugger events to offscreen inspector
  chrome.runtime.sendMessage({
    event: "DEBUGGER_EVENT",
    source,
    method,
    params,
  });
});

// Handle debugger commands from offscreen
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "DEBUGGER_SEND_COMMAND":
      try {
        chrome.debugger.sendCommand(
          msg.target,
          msg.method,
          msg.params,
          (result) => {
            sendResponse({ result });
          },
        );
      } catch (error) {
        sendResponse({ error: error.message });
      }
      break;
    case "DEBUGGER_ATTACH":
      try {
        chrome.debugger.attach(msg.target, "1.3", () => {
          sendResponse({ success: true });
        });
      } catch (error) {
        sendResponse({ error: error.message });
      }
      break;
    case "DEBUGGER_DETACH":
      try {
        chrome.debugger.detach(msg.target, () => {
          sendResponse({ success: true });
        });
      } catch (error) {
        sendResponse({ error: error.message });
      }
      break;
  }
  return true; // Keep the message channel open for async response
});

// Main serving logic
async function handleRequest(request) {
  const activeTabId = await getActiveTabId();
  const response = await chrome.runtime.sendMessage({
    ...request,
    tabId: activeTabId,
  });
  console.log("response received:", response);
  return response;
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  loadSettings().then(() => {
    if (changes.pollingEnabled.newValue && !changes.pollingEnabled.oldValue) {
      pollAndConnect();
    }
  });
});

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get([
    "host",
    "port",
    "pollingEnabled",
    "pollingInterval",
  ]);
  settings = {
    host: stored.host || "127.0.0.1",
    port: stored.port || 9333,
    pollingEnabled: stored.pollingEnabled !== false, // default true
    pollingInterval: stored.pollingInterval || 2000,
  };
  console.log("[Settings] Loaded:", settings);
}

// Check if server is available using HTTP polling (silent on failure)
async function checkServerAvailability() {
  if (!settings.pollingEnabled) {
    return false;
  }

  const healthUrl = `http://${settings.host}:${settings.port}/health`;

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    return response.ok;
  } catch (error) {
    // Silent failure - this is expected when server is not available
    return false;
  }
}

// Connect to WebSocket server
function connectWebSocket() {
  const wsUrl = `ws://${settings.host}:${settings.port}`;
  console.log(`[WS] Connecting to ${wsUrl}...`);

  ws = new WebSocket(wsUrl);

  const cleanUp = () => {
    ws.close();
    ws = null; // remove the only reference, effectively cleanup
  };

  ws.onopen = () => {
    console.log("[WS] Connected successfully");
  };

  ws.onmessage = async (event) => {
    console.log("[WS] Request received:", event.data);
    try {
      const req = JSON.parse(event.data);
      const response = await handleRequest(req);
      console.log("response:", response);
      ws.send(JSON.stringify({ id: req.id, ...response }));
    } catch (e) {
      console.error("[WS] Failed to parse message:", e);
    }
  };

  ws.onerror = (event) => {
    if (ws.readyState === WebSocket.CLOSED) {
      // Connection lost, will be handled by onclose
      return;
    }
    console.error("[WS] Error occurred:", event);
  };

  ws.onclose = () => {
    console.log("[WS] Connection closed");
    cleanUp();
    pollAndConnect();
  };
}

// Poll and connect
async function pollAndConnect() {
  while (settings.pollingEnabled) {
    const available = await checkServerAvailability();

    if (available) {
      console.log("[Poll] Server is available, connecting WebSocket...");
      connectWebSocket();
      return;
    }
    // Server not available, wait until next poll
    await new Promise((r) => setTimeout(r, settings.pollingInterval));
  }
}

async function main() {
  await loadSettings();
  await chrome.offscreen.createDocument({
    url: "offscreen_inspectors.html",
    reasons: ["DOM_PARSER"],
    justification: "Providing DOM implementation for inspector.",
  });
  pollAndConnect();
}

// Handle extension lifecycle
chrome.runtime.onStartup.addListener(() => {
  console.log("[Lifecycle] Extension started");
  main();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Lifecycle] Extension installed/updated");
  main();
});
