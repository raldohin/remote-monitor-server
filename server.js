const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'remote-monitor-secure-jwt-secret-key-2026';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'viewer')));

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e7
});

// ==========================================
// 1. NEON CLOUD POSTGRESQL (LIFETIME STORAGE)
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const initDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Connected to Neon Cloud PostgreSQL Database.');

    // Seed default admin account if table is new
    const checkAdmin = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (checkAdmin.rows.length === 0) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('admin12345', salt);
      await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', ['admin', hash]);
      console.log('Default user (admin / admin12345) ready.');
    }
  } catch (err) {
    console.error('Database initialization error:', err.message);
  }
};
initDatabase();

// ==========================================
// 2. AUTHENTICATION ENDPOINTS
// ==========================================
app.post('/api/register', async (req, res) => {
  const { username, password, confirmPassword } = req.body;

  if (!username || !password || !confirmPassword) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Password does not match.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }

  try {
    const cleanUsername = username.trim().toLowerCase();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
      [cleanUsername, passwordHash]
    );

    return res.status(201).json({ success: true, message: 'Account created successfully! Please log in.' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Username is already taken.' });
    }
    return res.status(500).json({ success: false, message: 'Registration failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      token,
      username: user.username
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

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

  socket.on('unregister_sender', ({ deviceId }) => {
    if (!deviceId) return;
    const cleanId = deviceId.trim().toUpperCase();
    activeDevices.delete(cleanId);
    io.to(`room_${cleanId}`).emit('sender_status', { available: false, deviceId: cleanId });
    console.log(`📱 Phone explicitly unregistered: room_${cleanId}`);
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

  // Flow-controlled frame relay with immediate acknowledgement
  socket.on('video_frame', (frameData, ackCallback) => {
    if (boundDeviceId) {
      socket.to(`room_${boundDeviceId}`).emit('video_frame', frameData);
    }
    if (typeof ackCallback === 'function') {
      ackCallback({ ok: true });
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
      if (activeDevices.get(boundDeviceId) === socket.id) {
        activeDevices.delete(boundDeviceId);
        io.to(`room_${boundDeviceId}`).emit('sender_status', { available: false, deviceId: boundDeviceId });
        console.log(`Phone disconnected from room_${boundDeviceId}`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server active on port ${PORT}`);
});