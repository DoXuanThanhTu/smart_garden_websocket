// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');

const app = express();
app.use(bodyParser.json());

// ================== CONFIG ==================
const PORT = process.env.PORT || 3000;
const DEVICE_TIMEOUT = 10 * 60 * 1000; // 10 phút
const CLEANUP_INTERVAL = 60 * 1000;    // 1 phút
const LOG_THROTTLE_INTERVAL = 5000;    // 5 giây

// ================== ERROR HANDLING TOÀN CẦU ==================
process.on('uncaughtException', err => console.error('Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

// ================== DATA STRUCTURES ==================
const devices = {};       // { deviceId: ws }
const dashboards = new Set();
const deviceLastSeen = {}; // { deviceId: timestamp }

// ================== LOG THROTTLE ==================
let lastLogTime = 0;
function throttleLog(...args) {
  const now = Date.now();
  if(now - lastLogTime > LOG_THROTTLE_INTERVAL){
    console.log(...args);
    lastLogTime = now;
  }
}

// ================== WEBSOCKET SERVER ==================
const wss = new WebSocket.Server({ noServer: true });

// ================== CLEANUP DEVICE OFFLINE ==================
setInterval(() => {
  const now = Date.now();
  for(const id in deviceLastSeen){
    if(now - deviceLastSeen[id] > DEVICE_TIMEOUT){
      throttleLog(`[${new Date().toISOString()}] Removing inactive device: ${id}`);
      if(devices[id] && devices[id].readyState === WebSocket.OPEN) {
        devices[id].terminate();
      }
      delete devices[id];
      delete deviceLastSeen[id];

      // Thông báo dashboard device offline
      dashboards.forEach(d => {
        if(d.readyState === WebSocket.OPEN){
          try { d.send(JSON.stringify({ deviceId: id, connected: false })); } catch {}
        }
      });
    }
  }
}, CLEANUP_INTERVAL);

// ================== WEBSOCKET CONNECTION HANDLER ==================
wss.on('connection', (ws, req, deviceId, type) => {
  try {
    if(type === 'esp32'){
      devices[deviceId] = ws;
      deviceLastSeen[deviceId] = Date.now();
      throttleLog(`[${new Date().toISOString()}] ESP32 connected: ${deviceId}`);

      // Thông báo tới dashboard ESP32 vừa connect
      dashboards.forEach(d => {
        if(d.readyState === WebSocket.OPEN){
          try { d.send(JSON.stringify({ deviceId, connected: true })); } catch {}
        }
      });

      ws.on('message', message => {
        try {
          const data = JSON.parse(message);
          deviceLastSeen[deviceId] = Date.now(); // update last seen

          // Broadcast tới tất cả dashboard
          dashboards.forEach(d => {
            if(d.readyState === WebSocket.OPEN){
              try { d.send(JSON.stringify(data)); } catch {}
            }
          });
        } catch(e) {
          throttleLog(`[${new Date().toISOString()}] Invalid JSON from ${deviceId}: ${message.toString()}`);
        }
      });

      ws.on('close', () => {
        delete devices[deviceId];
        delete deviceLastSeen[deviceId];
        throttleLog(`[${new Date().toISOString()}] ESP32 disconnected: ${deviceId}`);

        dashboards.forEach(d => {
          if(d.readyState === WebSocket.OPEN){
            try { d.send(JSON.stringify({ deviceId, connected: false })); } catch {}
          }
        });
      });

      ws.on('error', err => throttleLog(`[${new Date().toISOString()}] ESP32 WS Error:`, err));

    } else if(type === 'dashboard'){
      dashboards.add(ws);
      throttleLog(`[${new Date().toISOString()}] Dashboard connected`);

      ws.on('close', () => {
        dashboards.delete(ws);
        throttleLog(`[${new Date().toISOString()}] Dashboard disconnected`);
      });

      ws.on('error', err => throttleLog(`[${new Date().toISOString()}] Dashboard WS Error:`, err));
    }
  } catch(err) {
    console.error('Error in WebSocket connection handler:', err);
  }
});

// ================== HTTP SERVER ==================
const server = app.listen(PORT, () =>
  console.log(`[Server] Running on port ${PORT}`)
);

// Nâng cấp HTTP → WebSocket
server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if(url.searchParams.get('deviceId')){
      const deviceId = url.searchParams.get('deviceId');
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, deviceId, 'esp32'));
    } else if(url.searchParams.get('dashboard')){
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, null, 'dashboard'));
    } else {
      socket.destroy();
    }
  } catch(err) {
    console.error('Error during upgrade:', err);
    socket.destroy();
  }
});

// ================== API điều khiển pump ==================
app.post('/control/:deviceId', (req, res) => {
  try {
    const { deviceId } = req.params;
    const { pump } = req.body;

    const ws = devices[deviceId];
    if(ws && ws.readyState === WebSocket.OPEN){
      try { ws.send(JSON.stringify({ pump })); } catch {}
      res.json({ status: 'ok' });
    } else {
      res.status(404).json({ status: 'offline' });
    }
  } catch(err) {
    console.error('Error in /control:', err);
    res.status(500).json({ status: 'error' });
  }
});
// ================== SELF PING OPTIMIZED ==================
let selfPingTimer = null;

function randomInterval(minSec = 10, maxSec = 20) {
  return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
}

async function selfPing() {
  try {
    const res = await fetch(`${process.env.SERVER_URL}/health`);
    const data = await res.json();
    console.log(`[${new Date().toISOString()}] Self ping response:`, data);
  } catch(err) {
    console.error(`[${new Date().toISOString()}] Self ping error:`, err);
  } finally {
    // Xoá timer cũ (nếu có) trước khi tạo timer mới
    if (selfPingTimer) clearTimeout(selfPingTimer);
    selfPingTimer = setTimeout(selfPing, randomInterval());
  }
}

// Endpoint /health để ping
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Khởi động self-ping lần đầu
selfPingTimer = setTimeout(selfPing, randomInterval());

