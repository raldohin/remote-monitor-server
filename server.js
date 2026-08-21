const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

let lastSenderId = null;

app.use(express.static(path.join(__dirname, 'viewer')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // If phone registers or sends telemetry
  socket.on('register', (role) => {
    if (role === 'sender' || role === 'phone') {
      lastSenderId = socket.id;
      io.emit('phone_status', { online: true });
      console.log('Phone registered:', socket.id);
    } else if (role === 'viewer') {
      socket.emit('phone_status', { online: lastSenderId !== null });
    }
  });

  socket.on('heartbeat', () => {
    lastSenderId = socket.id;
    io.emit('phone_status', { online: true });
  });

  socket.on('telemetry', (data) => {
    lastSenderId = socket.id;
    io.emit('phone_status', { online: true });
    socket.broadcast.emit('telemetry', data);
  });

  socket.on('signal', (data) => {
    socket.broadcast.emit('signal', data);
  });

  socket.on('command', (data) => {
    socket.broadcast.emit('command', data);
  });

  socket.on('disconnect', () => {
    if (socket.id === lastSenderId) {
      lastSenderId = null;
      io.emit('phone_status', { online: false });
      console.log('Phone disconnected');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
