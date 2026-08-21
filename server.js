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
  allowEIO3: true
});

const PORT = process.env.PORT || 3000;

let phoneSocketId = null;

app.use(express.static(path.join(__dirname, 'viewer')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

app.get('/status', (req, res) => {
  res.json({ phoneOnline: phoneSocketId !== null });
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Catch all sender registration formats
  socket.on('register', (role) => {
    if (role === 'sender' || role === 'phone') {
      phoneSocketId = socket.id;
      io.emit('phone_status', { online: true });
      console.log('Phone registered via register:', socket.id);
    } else if (role === 'viewer') {
      socket.emit('phone_status', { online: phoneSocketId !== null });
    }
  });

  socket.on('register_sender', () => {
    phoneSocketId = socket.id;
    io.emit('phone_status', { online: true });
    console.log('Phone registered via register_sender:', socket.id);
  });

  socket.on('heartbeat', () => {
    phoneSocketId = socket.id;
    io.emit('phone_status', { online: true });
  });

  // Relay signals
  socket.on('signal', (data) => socket.broadcast.emit('signal', data));
  socket.on('offer', (data) => socket.broadcast.emit('signal', { type: 'offer', sdp: data }));
  socket.on('answer', (data) => socket.broadcast.emit('signal', { type: 'answer', sdp: data }));
  socket.on('ice-candidate', (data) => socket.broadcast.emit('signal', { type: 'candidate', candidate: data }));

  // Relay telemetry & mark phone active
  socket.on('telemetry', (data) => {
    phoneSocketId = socket.id;
    socket.broadcast.emit('telemetry', data);
  });

  // Relay commands to sender
  socket.on('command', (data) => socket.broadcast.emit('command', data));

  socket.on('disconnect', () => {
    if (socket.id === phoneSocketId) {
      phoneSocketId = null;
      io.emit('phone_status', { online: false });
      console.log('Phone disconnected');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
