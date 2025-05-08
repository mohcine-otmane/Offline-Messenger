import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

interface User {
  id: string;
  username: string;
}

const users = new Map<string, User>();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('user_join', (username: string) => {
    console.log('User joined:', username, socket.id);
    users.set(socket.id, { id: socket.id, username });
    io.emit('user_list', Array.from(users.values()));
  });

  socket.on('message', (text: string) => {
    const user = users.get(socket.id);
    if (user) {
      const message = {
        user: user.username,
        text,
        time: new Date().toLocaleTimeString()
      };
      io.emit('message', message);
    }
  });

  socket.on('video_offer', (data) => {
    console.log('Video offer from', socket.id, 'to', data.target);
    const targetSocket = io.sockets.sockets.get(data.target);
    if (targetSocket) {
      targetSocket.emit('video_offer', {
        from: socket.id,
        sdp: data.sdp
      });
    }
  });

  socket.on('video_answer', (data) => {
    console.log('Video answer from', socket.id, 'to', data.target);
    const targetSocket = io.sockets.sockets.get(data.target);
    if (targetSocket) {
      targetSocket.emit('video_answer', {
        from: socket.id,
        sdp: data.sdp
      });
    }
  });

  socket.on('ice_candidate', (data) => {
    console.log('ICE candidate from', socket.id, 'to', data.target);
    const targetSocket = io.sockets.sockets.get(data.target);
    if (targetSocket) {
      targetSocket.emit('ice_candidate', {
        from: socket.id,
        candidate: data.candidate
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    users.delete(socket.id);
    io.emit('user_list', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 