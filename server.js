const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, '../viewer')));

let senderSocketId = null;

io.on('connection', (socket) => {
  console.log(`[CONNECTED] Client ID: ${socket.id}`);

  // Register device as the remote phone sender
  socket.on('register_sender', () => {
    senderSocketId = socket.id;
    console.log(`📱 Phone registered as Sender: ${senderSocketId}`);
    socket.broadcast.emit('sender_status', { available: true });
  });

  // Viewer requests current status
  socket.on('check_sender', () => {
    socket.emit('sender_status', { available: senderSocketId !== null });
  });

  // Signal Strength / Latency Ping-Pong Relay
  socket.on('ping_phone', (timestamp) => {
    if (senderSocketId) {
      io.to(senderSocketId).emit('ping_check', timestamp);
    }
  });

  socket.on('pong_reply', (timestamp) => {
    socket.broadcast.emit('pong_viewer', timestamp);
  });

  // Viewer triggers stream start remotely
  socket.on('request_stream', () => {
    if (senderSocketId) {
      console.log(`📡 Viewer requesting stream -> Triggering phone: ${senderSocketId}`);
      io.to(senderSocketId).emit('start_capture');
    } else {
      socket.emit('sender_status', { available: false });
    }
  });

  // Viewer stops stream remotely
  socket.on('stop_stream', () => {
    if (senderSocketId) {
      io.to(senderSocketId).emit('stop_capture');
    }
  });

  // Relay Camera Switch Command
  socket.on('switch_camera', () => {
    if (senderSocketId) {
      console.log(`🔄 Switching camera on phone: ${senderSocketId}`);
      io.to(senderSocketId).emit('toggle_camera');
    }
  });

  // WebRTC Signaling relays
  socket.on('offer', (data) => {
    socket.broadcast.emit('offer', data);
  });

  socket.on('answer', (data) => {
    socket.broadcast.emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.broadcast.emit('ice-candidate', data);
  });

  // Sensor Telemetry relay
  socket.on('telemetry', (data) => {
    socket.broadcast.emit('telemetry', data);
  });

  socket.on('disconnect', (reason) => {
    if (socket.id === senderSocketId) {
      senderSocketId = null;
      console.log(`📱 Phone disconnected: ${socket.id}`);
      socket.broadcast.emit('sender_status', { available: false });
    }
    console.log(`[DISCONNECTED] Client ID: ${socket.id} | Reason: ${reason}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Signaling & Telemetry Server running on http://localhost:${PORT}`);
});