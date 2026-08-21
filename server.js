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
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Track active phone socket IDs
const activeSenders = new Set();

app.use(express.static(path.join(__dirname, 'viewer')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', phoneOnline: activeSenders.size > 0 });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (role) => {
    socket.join(role);
    socket.dataRole = role;

    if (role === 'sender' || role === 'phone') {
      activeSenders.add(socket.id);
      console.log(`Phone registered [${socket.id}]. Total active phones: ${activeSenders.size}`);
      io.emit('phone_status', { online: true });
    } else if (role === 'viewer') {
      // Notify viewer immediately of actual phone status
      socket.emit('phone_status', { online: activeSenders.size > 0 });
    }
  });

  // Heartbeat ping from phone
  socket.on('heartbeat', () => {
    if (socket.dataRole === 'sender' || socket.dataRole === 'phone') {
      if (!activeSenders.has(socket.id)) {
        activeSenders.add(socket.id);
        io.emit('phone_status', { online: true });
      }
    }
  });

  socket.on('telemetry', (data) => {
    if (!activeSenders.has(socket.id)) {
      activeSenders.add(socket.id);
      io.emit('phone_status', { online: true });
    }
    socket.broadcast.emit('telemetry', data);
  });

  socket.on('signal', (data) => socket.broadcast.emit('signal', data));
  socket.on('command', (data) => socket.broadcast.emit('command', data));

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected [${socket.id}], reason: ${reason}`);

    if (activeSenders.has(socket.id)) {
      activeSenders.delete(socket.id);
      console.log(`Phone disconnected. Remaining phones: ${activeSenders.size}`);
      if (activeSenders.size === 0) {
        io.emit('phone_status', { online: false });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
