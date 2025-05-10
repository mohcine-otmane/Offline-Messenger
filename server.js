const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'build')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const users = new Map();

io.on('connection', (socket) => {
  socket.on('user_join', (username) => {
    users.set(socket.id, { id: socket.id, username });
    io.emit('user_list', Array.from(users.values()));
    io.emit('message', {
      user: 'System',
      text: `${username} has joined the chat`,
      time: new Date().toLocaleTimeString()
    });
  });

  socket.on('message', (message) => {
    const user = users.get(socket.id);
    if (user) {
      io.emit('message', {
        user: user.username,
        text: message,
        time: new Date().toLocaleTimeString()
      });
    }
  });

  socket.on('video_offer', (data) => {
    const user = users.get(socket.id);
    if (user) {
      io.to(data.target).emit('video_offer', {
        sdp: data.sdp,
        from: socket.id,
        username: user.username
      });
    }
  });

  socket.on('video_answer', (data) => {
    const user = users.get(socket.id);
    if (user) {
      io.to(data.target).emit('video_answer', {
        sdp: data.sdp,
        from: socket.id,
        username: user.username
      });
    }
  });

  socket.on('ice_candidate', (data) => {
    const user = users.get(socket.id);
    if (user) {
      io.to(data.target).emit('ice_candidate', {
        candidate: data.candidate,
        from: socket.id,
        username: user.username
      });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      io.emit('user_list', Array.from(users.values()));
      io.emit('message', {
        user: 'System',
        text: `${user.username} has left the chat`,
        time: new Date().toLocaleTimeString()
      });
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
}); 