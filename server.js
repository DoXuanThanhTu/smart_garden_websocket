// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');

const app = express();
app.use(bodyParser.json());

const devices = {};      // { deviceId: ws }
const dashboards = new Set();

const wss = new WebSocket.Server({ noServer: true });

// ================= WebSocket connections =================
wss.on('connection', (ws, request, deviceId, type) => {
    if(type === 'esp32'){
        devices[deviceId] = ws;
        console.log(`[${new Date().toISOString()}] ESP32 connected: ${deviceId}`);

        // Thông báo tới dashboard ESP32 vừa connect
        dashboards.forEach(d => {
            if(d.readyState === WebSocket.OPEN)
                d.send(JSON.stringify({ deviceId, connected: true }));
        });

        ws.on('message', message => {
            try {
                const data = JSON.parse(message);

                // Log dữ liệu nhận được
                console.log(`[${new Date().toISOString()}] Data from ${deviceId}:`, data);

                // Gửi dữ liệu tới tất cả dashboard
                dashboards.forEach(d => {
                    if(d.readyState === WebSocket.OPEN)
                        d.send(JSON.stringify(data));
                });
            } catch(e) {
                console.log(`[${new Date().toISOString()}] Invalid JSON from ${deviceId}:`, message.toString());
            }
        });

        ws.on('close', () => {
            delete devices[deviceId];
            console.log(`[${new Date().toISOString()}] ESP32 disconnected: ${deviceId}`);

            dashboards.forEach(d => {
                if(d.readyState === WebSocket.OPEN)
                    d.send(JSON.stringify({ deviceId, connected: false }));
            });
        });

    } else if(type === 'dashboard'){
        dashboards.add(ws);
        console.log(`[${new Date().toISOString()}] Dashboard connected`);

        ws.on('close', () => {
            dashboards.delete(ws);
            console.log(`[${new Date().toISOString()}] Dashboard disconnected`);
        });
    }
});

// ================= HTTP server =================
const server = app.listen(process.env.PORT || 3000, () =>
    console.log(`Server running on port ${process.env.PORT || 3000}`)
);

// Nâng cấp HTTP → WebSocket
server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if(url.searchParams.get('deviceId')){
        const deviceId = url.searchParams.get('deviceId');
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, deviceId, 'esp32'));
    } else if(url.searchParams.get('dashboard')){
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, null, 'dashboard'));
    } else {
        socket.destroy();
    }
});

// ================= API điều khiển pump =================
app.post('/control/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const { pump } = req.body;

    const ws = devices[deviceId];
    if(ws && ws.readyState === WebSocket.OPEN){
        ws.send(JSON.stringify({ pump }));
        res.json({ status: 'ok' });
    } else {
        res.status(404).json({ status: 'offline' });
    }
});
