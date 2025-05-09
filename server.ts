import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import session from 'express-session';

import 'express-session';
declare module 'http' {
  interface IncomingMessage {
    sessionID?: string;
    session?: any;
  }
}

const app = express();
app.use(cors({ origin: true, credentials: true }));

app.use(session({
  secret: 'offline-messenger-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

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
  sessionId: string;
}

const users = new Map<string, User>(); // sessionId -> User

io.on('connection', (socket) => {
  // @ts-ignore
  const req = socket.request;
  const sessionId = req.sessionID || socket.id;
  console.log('Client connected:', socket.id, 'Session:', sessionId);

  socket.on('user_join', (username: string) => {
    console.log('User joined:', username, socket.id, 'Session:', sessionId);
    users.set(String(sessionId), { id: socket.id, username, sessionId: String(sessionId) });
    io.emit('user_list', Array.from(users.values()).map(u => ({ id: u.id, username: u.username })));
  });

  socket.on('message', (text: string) => {
    const user = users.get(String(sessionId));
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
    const targetUser = Array.from(users.values()).find(u => u.id === data.target);
    if (targetUser) {
      const targetSocket = io.sockets.sockets.get(targetUser.id);
      if (targetSocket) {
        targetSocket.emit('video_offer', {
          from: socket.id,
          sdp: data.sdp
        });
      }
    }
  });

  socket.on('video_answer', (data) => {
    console.log('Video answer from', socket.id, 'to', data.target);
    const targetUser = Array.from(users.values()).find(u => u.id === data.target);
    if (targetUser) {
      const targetSocket = io.sockets.sockets.get(targetUser.id);
      if (targetSocket) {
        targetSocket.emit('video_answer', {
          from: socket.id,
          sdp: data.sdp
        });
      }
    }
  });

  socket.on('ice_candidate', (data) => {
    console.log('ICE candidate from', socket.id, 'to', data.target);
    const targetUser = Array.from(users.values()).find(u => u.id === data.target);
    if (targetUser) {
      const targetSocket = io.sockets.sockets.get(targetUser.id);
      if (targetSocket) {
        targetSocket.emit('ice_candidate', {
          from: socket.id,
          candidate: data.candidate
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id, 'Session:', sessionId);
    users.delete(String(sessionId));
    io.emit('user_list', Array.from(users.values()).map(u => ({ id: u.id, username: u.username })));
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 