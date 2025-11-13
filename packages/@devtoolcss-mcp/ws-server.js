#!/usr/bin/env node
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import readline from "readline";

const PORT = process.env.PORT || 9333;

// Create HTTP server
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        status: "ok",
        timestamp: Date.now(),
        service: "DevtoolCSS MCP Server",
      }),
    );
    return;
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

console.log(`[Server] HTTP + WebSocket server listening on:`);
console.log(`  - HTTP: http://127.0.0.1:${PORT}/health`);
console.log(`  - WebSocket: ws://127.0.0.1:${PORT}`);

const handleMessage = (message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log("[WS] Message received:", data);
  } catch (e) {
    console.error("[WS] Failed to parse message:", e);
  }
};

let activeWs = null; // Track the active WebSocket connection

wss.on("connection", (ws) => {
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    ws.close(1000, "Only one connection allowed");
    console.log("[WS] Refused new connection: already connected");
    return;
  }
  activeWs = ws;
  console.log("[WS] Client connected");

  ws.on("message", (message) => {
    console.log("[WS] Received:", message.toString());
    handleMessage(message);
  });

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    if (activeWs === ws) {
      activeWs = null;
    }
  });

  ws.on("error", (error) => {
    console.error("[WS] Error:", error);
  });
});

wss.on("error", (error) => {
  console.error("[WS] Server error:", error);
});

// Start server
server.listen(PORT, "127.0.0.1", () => {
  console.log("[Server] Ready to accept connections");
});
// Setup readline interface for stdin
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  try {
    const json = JSON.parse(line);
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      activeWs.send(JSON.stringify(json));
    }
    // Optionally, log if no active connection
  } catch (e) {
    console.error("Failed to parse stdin line as JSON:", e);
    // Ignore lines that are not valid JSON
  }
});
