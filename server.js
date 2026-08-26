const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'remote-monitor-secure-jwt-secret-key-2026';
const PORT = process.env.PORT || 3000;

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

// ==========================================
// 1. SQLITE DATABASE INITIALIZATION
// ==========================================
const db = new sqlite3.Database(path.join(__dirname, 'users.db'), (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
});

// ==========================================
// 2. AUTHENTICATION REST APIS
// ==========================================

// Register Account
app.post('/api/register', async (req, res) => {
  const { username, password, confirmPassword } = req.body;

  if (!username || !password || !confirmPassword) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Password does not match.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const query = `INSERT INTO users (username, password_hash) VALUES (?, ?)`;
    db.run(query, [username.trim().toLowerCase(), passwordHash], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ success: false, message: 'Username is already taken.' });
        }
        return res.status(500).json({ success: false, message: 'Database error during registration.' });
      }
      return res.status(201).json({ success: true, message: 'Account created successfully! Please log in.' });
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error hashing password.' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const query = `SELECT * FROM users WHERE username = ?`;
  db.get(query, [username.trim().toLowerCase()], async (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error during authentication.' });
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      token,
      username: user.username
    });
  });
});

// Verify Token
app.get('/api/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({ valid: true, user: decoded });
  } catch (err) {
    return res.status(401).json({ valid: false });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

// ==========================================
// 3. SOCKET SIGNALING & TELEMETRY
// ==========================================
const activeDevices = new Map();

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