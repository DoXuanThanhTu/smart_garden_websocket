require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ======================== WEBSOCKET ========================
const devices = {}; // { deviceId: ws }
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, request, deviceId) => {
    console.log(`ESP32 connected: ${deviceId}`);
    devices[deviceId] = ws;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        console.log('Sensor data:', data);
    });

    ws.on('close', () => {
        delete devices[deviceId];
        console.log(`ESP32 disconnected: ${deviceId}`);
    });
});

// ======================== HTTP SERVER ========================
const server = app.listen(process.env.PORT || 3000, () => 
    console.log(`Server running on port ${process.env.PORT || 3000}`)
);

// Nâng cấp kết nối lên WebSocket
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const deviceId = url.searchParams.get('deviceId');
    if (!deviceId) {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, deviceId));
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

// ======================== AUTO PING ========================
if (process.env.SERVER_URL) {
    const pingSelf = async () => {
        try {
            await axios.get(process.env.SERVER_URL);
            console.log('Pinged self successfully');
        } catch (err) {
            console.error('Ping self failed:', err.message);
        } finally {
            const interval = 10000 + Math.random() * 5000;
            console.log("Next self-ping in", (interval / 1000).toFixed(2), "s");
            setTimeout(pingSelf, interval);
        }
    };
    pingSelf();
}

