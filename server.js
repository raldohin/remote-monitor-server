const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// Serve static viewer files
app.use(express.static(path.join(__dirname, 'viewer')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'viewer', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (role) => {
    socket.join(role);
    console.log(`Socket ${socket.id} registered as ${role}`);
    io.emit('phone_status', { online: true });
  });

  socket.on('signal', (data) => {
    socket.broadcast.emit('signal', data);
  });

  socket.on('telemetry', (data) => {
    socket.broadcast.emit('telemetry', data);
  });

  socket.on('command', (data) => {
    socket.broadcast.emit('command', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    io.emit('phone_status', { online: false });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
