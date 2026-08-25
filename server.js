const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'viewer')));

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 3000;

const users = new Map();
const activeDevices = new Map();

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }
  if (users.has(username)) {
    return res.status(409).json({ success: false, message: 'Username already exists.' });
  }
  users.set(username, password);
  return res.json({ success: true, message: 'Account created successfully.' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!users.has(username) || users.get(username) !== password) {
    return res.status(401).json({ success: false, message: 'Invalid username or password.' });
  }
  return res.json({ success: true, message: 'Logged in successfully.' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

io.on('connection', (socket) => {
  let boundDeviceId = null;
  let clientRole = null;

  socket.on('register_sender', ({ deviceId }) => {
    if (!deviceId) return;
    boundDeviceId = deviceId.trim().toUpperCase();
    clientRole = 'sender';
    
    socket.join(`room_${boundDeviceId}`);
    activeDevices.set(boundDeviceId, socket.id);
    
    console.log(`📱 Phone registered to room: room_${boundDeviceId}`);
    io.to(`room_${boundDeviceId}`).emit('sender_status', { available: true, deviceId: boundDeviceId });
  });

  socket.on('pair_viewer', ({ deviceId }) => {
    if (!deviceId) return;
    boundDeviceId = deviceId.trim().toUpperCase();
    clientRole = 'viewer';

    socket.join(`room_${boundDeviceId}`);
    const isOnline = activeDevices.has(boundDeviceId);
    
    console.log(`💻 Viewer joined room_${boundDeviceId} (Status: ${isOnline ? 'Online' : 'Offline'})`);
    socket.emit('sender_status', { available: isOnline, deviceId: boundDeviceId });
  });

  socket.on('heartbeat', ({ deviceId }) => {
    if (!deviceId) return;
    const cleanId = deviceId.trim().toUpperCase();
    activeDevices.set(cleanId, socket.id);
    io.to(`room_${cleanId}`).emit('sender_status', { available: true, deviceId: cleanId });
  });

  socket.on('video_frame', (frameData) => {
    if (boundDeviceId) {
      socket.to(`room_${boundDeviceId}`).emit('video_frame', frameData);
    }
  });

  socket.on('ping_phone', (timestamp) => {
    if (boundDeviceId) {
      socket.to(`room_${boundDeviceId}`).emit('ping_phone', timestamp);
    }
  });

  socket.on('pong_viewer', (timestamp) => {
    if (boundDeviceId) {
      socket.to(`room_${boundDeviceId}`).emit('pong_viewer', timestamp);
    }
  });

  socket.on('signal', (data) => {
    if (boundDeviceId) {
      socket.to(`room_${boundDeviceId}`).emit('signal', data);
    }
  });

  socket.on('telemetry', (data) => {
    if (boundDeviceId) {
      socket.to(`room_${boundDeviceId}`).emit('telemetry', data);
    }
  });

  socket.on('command', (data) => {
    if (boundDeviceId) {
      socket.to(`room_${boundDeviceId}`).emit('command', data);
    }
  });

  socket.on('disconnect', () => {
    if (clientRole === 'sender' && boundDeviceId) {
      activeDevices.delete(boundDeviceId);
      io.to(`room_${boundDeviceId}`).emit('sender_status', { available: false, deviceId: boundDeviceId });
      console.log(`Phone disconnected from room_${boundDeviceId}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server active on port ${PORT}`);
});
