require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// ======================== DASHBOARD ========================
app.get('/', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ======================== WEBSOCKET ========================
const devices = {};       // ESP32 connections { deviceId: ws }
const dashboardClients = new Set(); // Browser clients

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, request, deviceId, type) => {
    if (type === 'esp32') {
        console.log(`ESP32 connected: ${deviceId}`);
        devices[deviceId] = ws;

        ws.on('message', (message) => {
            const data = JSON.parse(message);
            console.log('Sensor data:', data);

            // Broadcast dữ liệu tới dashboard
            dashboardClients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
            });
        });

        ws.on('close', () => {
            delete devices[deviceId];
            console.log(`ESP32 disconnected: ${deviceId}`);
        });

    } else if (type === 'dashboard') {
        console.log('Dashboard connected');
        dashboardClients.add(ws);

        ws.on('close', () => {
            dashboardClients.delete(ws);
            console.log('Dashboard disconnected');
        });
    }
});

// Nâng cấp HTTP → WebSocket
const server = app.listen(process.env.PORT || 3000, () => 
    console.log(`Server running on port ${process.env.PORT || 3000}`)
);

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.searchParams.get('deviceId')) {
        // ESP32
        const deviceId = url.searchParams.get('deviceId');
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, deviceId, 'esp32'));
    } else if (url.searchParams.get('dashboard')) {
        // Dashboard
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, null, 'dashboard'));
    } else {
        socket.destroy();
    }
});

// ======================== API CONTROL ========================
app.post('/control/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const { pump } = req.body;

    const ws = devices[deviceId];
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ pump }));
        res.json({ status: 'ok' });
    } else {
        res.status(404).json({ status: 'offline' });
    }
});
