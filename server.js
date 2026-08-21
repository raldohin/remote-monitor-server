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
  }
});

const PORT = process.env.PORT || 3000;

let phoneSocketId = null;

app.use(express.static(path.join(__dirname, 'viewer')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('register', (role) => {
    socket.join(role);
    if (role === 'sender' || role === 'phone') {
      phoneSocketId = socket.id;
      io.emit('phone_status', { online: true });
      console.log('Phone locked:', phoneSocketId);
    } else if (role === 'viewer') {
      socket.emit('phone_status', { online: phoneSocketId !== null });
    }
  });

  socket.on('heartbeat', () => {
    phoneSocketId = socket.id;
    io.emit('phone_status', { online: true });
  });

  // Targeted signal relay
  socket.on('signal', (data) => {
    if (socket.id === phoneSocketId) {
      // Forward offer/candidates from phone directly to viewers
      socket.to('viewer').emit('signal', data);
    } else if (phoneSocketId) {
      // Forward answer/candidates from viewer directly to the phone
      io.to(phoneSocketId).emit('signal', data);
    }
  });

  socket.on('telemetry', (data) => {
    phoneSocketId = socket.id;
    socket.to('viewer').emit('telemetry', data);
  });

  socket.on('command', (data) => {
    if (phoneSocketId) {
      io.to(phoneSocketId).emit('command', data);
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === phoneSocketId) {
      phoneSocketId = null;
      io.emit('phone_status', { online: false });
      console.log('Phone disconnected');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
