#!/usr/bin/env node
import http from "http";
import WebSocket from "ws";

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
const wss = new WebSocket.Server({ server });

console.log(`[Server] HTTP + WebSocket server listening on:`);
console.log(`  - HTTP: http://127.0.0.1:${PORT}/health`);
console.log(`  - WebSocket: ws://127.0.0.1:${PORT}`);

const handleMessage = (message) => {
  try {
    const data = JSON.parse(message.toString());

    // Handle different message types
    if (data.type === "ping") {
      ws.send(
        JSON.stringify({
          type: "pong",
          timestamp: Date.now(),
          original: data,
        }),
      );
    } else {
      // Echo back with a response
      ws.send(
        JSON.stringify({
          type: "response",
          original: data,
          timestamp: Date.now(),
        }),
      );
    }
  } catch (e) {
    console.error("[WS] Failed to parse message:", e);
  }
};

wss.on("connection", (ws) => {
  console.log("[WS] Client connected");

  ws.on("message", (message) => {
    console.log("[WS] Received:", message.toString());
    handleMessage(message);
  });

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
  });

  ws.on("error", (error) => {
    console.error("[WS] Error:", error);
  });

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "welcome",
      message: "Connected to DevtoolCSS MCP Server",
      timestamp: Date.now(),
    }),
  );
});

wss.on("error", (error) => {
  console.error("[WS] Server error:", error);
});

// Start server
server.listen(PORT, "127.0.0.1", () => {
  console.log("[Server] Ready to accept connections");
});
