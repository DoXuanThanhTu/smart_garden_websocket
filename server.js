import express from "express";
import WebSocket from "ws";

// ================== CONFIG ==================
const DEVICE_ID = "testdata_001";
const WS_URL = `wss://smart-garden-websocket.onrender.com/?deviceId=${DEVICE_ID}`;

// ================== GLOBAL ERROR PROTECTION ==================
process.on("uncaughtException", err => {
  console.error("[GLOBAL] Uncaught Exception:", err);
});
process.on("unhandledRejection", err => {
  console.error("[GLOBAL] Unhandled Rejection:", err);
});

// ================== LOG ==================
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// ================== EXPRESS HEALTH SERVER ==================
express()
  .get("/health", (req, res) => res.json({ status: "ok", deviceId: DEVICE_ID }))
  .listen(4000, () => log("[FAKE] Health server running on port 4000"));

// ================== WS CLIENT WITH AUTO-RECONNECT ==================
let ws;
let reconnectTimer = null;

function connectWS() {
  ws = new WebSocket(WS_URL, { rejectUnauthorized: false });

  ws.on("open", () => {
    log(`[FAKE] Connected as ${DEVICE_ID}`);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.on("message", msg => {
    try { 
      log("[FAKE] Received:", JSON.parse(msg.toString())); 
    } catch {
      log("[FAKE] Received invalid JSON:", msg.toString());
    }
  });

  ws.on("error", err => {
    log("[FAKE] WS Error:", err.message);
  });

  ws.on("close", () => {
    log("[FAKE] Disconnected from WS, reconnecting...");
    safeReconnect();
  });
}

function safeReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    log("[FAKE] Attempting reconnect...");
    connectWS();
  }, 3000);
}

connectWS(); // khởi động lần đầu

// ================== RANDOM HELPERS ==================
const random = (min, max, dec = 0) =>
  +(Math.random() * (max - min) + min).toFixed(dec);

// ================== SEND SENSOR DATA EVERY 5 SEC ==================
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const data = {
    deviceId: DEVICE_ID,
    temp: random(20, 30, 1),
    humidity: random(40, 70, 1),
    soil: Math.floor(random(50, 100)),
    pump: Math.random() > 0.5
  };

  try {
    ws.send(JSON.stringify(data));
    log("[FAKE] Sent sensor data:", data);
  } catch (err) {
    log("[FAKE] Send Error:", err.message);
  }
}, 5000);

// ================== SELF PING EVERY 10–20 SEC ==================
function randomInterval(minSec = 10, maxSec = 20) {
  return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
}

async function selfPing() {
  if (!process.env.SERVER_URL) return;

  try {
    const res = await fetch(`${process.env.SERVER_URL.replace(/\/$/, "")}/health`);
    const data = await res.json();
    log("[FAKE] Self ping response:", data);
  } catch (err) {
    log("[FAKE] Self ping error:", err.message);
  } finally {
    setTimeout(selfPing, randomInterval());
  }
}

if (process.env.SERVER_URL)
  setTimeout(selfPing, randomInterval());
