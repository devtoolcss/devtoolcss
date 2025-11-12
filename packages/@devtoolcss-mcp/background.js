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

// Handle messages from server
function handleMessage(data) {
  console.log("[Handler] Processing message:", data);
  // TODO: Implement your message handling logic here
}

// Listen for settings changes
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  await loadSettings();
  if (changes.pollingEnabled.newValue && !changes.pollingEnabled.oldValue) {
    pollAndConnect();
  }
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
    // Send a test message
    ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
  };

  ws.onmessage = (event) => {
    console.log("[WS] Message received:", event.data);
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
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

// Handle extension lifecycle
chrome.runtime.onStartup.addListener(() => {
  console.log("[Lifecycle] Extension started");
  keepAlive();
  loadSettings().then(() => pollAndConnect());
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Lifecycle] Extension installed/updated");
  keepAlive();
  loadSettings().then(() => pollAndConnect());
});
