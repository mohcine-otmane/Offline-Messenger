import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Box, Container, TextField, Button, Paper, Typography, List, ListItem, ListItemText, IconButton, Snackbar, Alert } from '@mui/material';
import { io, Socket } from 'socket.io-client';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import CallEndIcon from '@mui/icons-material/CallEnd';

interface Message {
  user: string;
  text: string;
  time: string;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  stream: MediaStream;
}

interface User {
  id: string;
  username: string;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [activeCall, setActiveCall] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<Map<string, PeerConnection>>(new Map());

  useEffect(() => {
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    const initializeVideoElements = () => {
      if (localVideoRef.current) {
        localVideoRef.current.onloadedmetadata = () => {
          console.log('Local video metadata loaded in effect');
          localVideoRef.current?.play()
            .then(() => console.log('Local video playing'))
            .catch(e => console.error('Error playing local video in effect:', e));
        };
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.onloadedmetadata = () => {
          console.log('Remote video metadata loaded in effect');
          remoteVideoRef.current?.play()
            .then(() => console.log('Remote video playing'))
            .catch(e => console.error('Error playing remote video in effect:', e));
        };
      }
    };

    initializeVideoElements();

    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to server with ID:', newSocket.id);
    });

    newSocket.on('message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
    });

    newSocket.on('user_list', (userList: User[]) => {
      console.log('Received user list:', userList);
      setUsers(userList);
    });

    newSocket.on('video_offer', async (data) => {
      console.log('Received video offer from:', data.from);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }, 
          audio: true 
        });
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const pc = createPeerConnection(data.from);
        stream.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind);
          pc.addTrack(track, stream);
        });

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('Set remote description');
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('Created and set local answer');

        socket?.emit('video_answer', {
          target: data.from,
          sdp: answer
        });

        peerConnections.current.set(data.from, { pc, stream });
        setActiveCall(data.from);
        setIsVideoEnabled(true);
      } catch (error) {
        console.error('Error handling video offer:', error);
        setError('Failed to start video call: ' + (error as Error).message);
      }
    });

    newSocket.on('video_answer', async (data) => {
      console.log('Received video answer from:', data.from);
      const pc = peerConnections.current.get(data.from)?.pc;
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          console.log('Set remote description from answer');
        } catch (error) {
          console.error('Error handling video answer:', error);
          setError('Failed to establish video connection: ' + (error as Error).message);
        }
      }
    });

    newSocket.on('ice_candidate', async (data) => {
      console.log('Received ICE candidate from:', data.from);
      const pc = peerConnections.current.get(data.from)?.pc;
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log('Added ICE candidate');
        } catch (error) {
          console.error('Error handling ICE candidate:', error);
        }
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createPeerConnection = (targetId: string): RTCPeerConnection => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };

    const pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to:', targetId);
        socket?.emit('ice_candidate', {
          target: targetId,
          candidate: event.candidate
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        console.log('ICE connection failed or disconnected');
        endVideoCall();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log('Signaling state:', pc.signalingState);
    };

    pc.ontrack = (event) => {
      console.log('Received track:', event.track.kind);
      console.log('Track settings:', event.track.getSettings());
      console.log('Track constraints:', event.track.getConstraints());
      console.log('Track ready state:', event.track.readyState);
      console.log('Streams:', event.streams);
      
      if (remoteVideoRef.current) {
        console.log('Setting remote video stream');
        const stream = event.streams[0];
        console.log('Remote stream tracks:', stream.getTracks().map(t => ({
          kind: t.kind,
          settings: t.getSettings(),
          readyState: t.readyState
        })));
        
        remoteVideoRef.current.srcObject = stream;
        
        setTimeout(() => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.play()
              .then(() => console.log('Remote video playing after delay'))
              .catch(e => console.error('Error playing remote video after delay:', e));
          }
        }, 1000);
      }
    };

    return pc;
  };

  const startVideoCall = async (targetId: string) => {
    console.log('Starting video call with:', targetId);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
          frameRate: { ideal: 30 }
        }, 
        audio: true 
      });
      
      console.log('Got local media stream:', stream.getTracks().map(t => ({
        kind: t.kind,
        settings: t.getSettings(),
        constraints: t.getConstraints(),
        readyState: t.readyState
      })));
      
      if (localVideoRef.current) {
        console.log('Setting local video stream');
        localVideoRef.current.srcObject = stream;
        
        setTimeout(() => {
          if (localVideoRef.current) {
            localVideoRef.current.play()
              .then(() => console.log('Local video playing after delay'))
              .catch(e => console.error('Error playing local video after delay:', e));
          }
        }, 1000);
      }

      const pc = createPeerConnection(targetId);
      stream.getTracks().forEach(track => {
        console.log('Adding track to peer connection:', track.kind);
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);
      console.log('Created and set local offer');

      socket?.emit('video_offer', {
        target: targetId,
        sdp: offer
      });

      peerConnections.current.set(targetId, { pc, stream });
      setActiveCall(targetId);
      setIsVideoEnabled(true);
    } catch (error) {
      console.error('Error starting video call:', error);
      setError('Failed to start video call: ' + (error as Error).message);
    }
  };

  const endVideoCall = () => {
    console.log('Ending video call');
    if (activeCall) {
      const connection = peerConnections.current.get(activeCall);
      if (connection) {
        connection.stream.getTracks().forEach(track => {
          console.log('Stopping track:', track.kind);
          track.stop();
        });
        connection.pc.close();
        peerConnections.current.delete(activeCall);
      }
      setActiveCall(null);
      setIsVideoEnabled(false);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    }
  };

  const handleJoin = () => {
    if (username.trim() && socket) {
      socket.emit('user_join', username);
      setHasJoined(true);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && socket) {
      socket.emit('message', message);
      setMessage('');
    }
  };

  if (!isConnected) {
    return (
      <Container maxWidth="md" sx={{ height: '100vh', py: 2 }}>
        <Paper elevation={3} sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="h6" color="error">Connecting to server...</Typography>
        </Paper>
      </Container>
    );
  }

  if (!hasJoined) {
    return (
      <Container maxWidth="md" sx={{ height: '100vh', py: 2 }}>
        <Paper elevation={3} sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, width: '100%', maxWidth: 400 }}>
            <Typography variant="h5" align="center">Enter your username</Typography>
            <TextField
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              variant="outlined"
              fullWidth
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleJoin();
                }
              }}
            />
            <Button 
              variant="contained" 
              onClick={handleJoin} 
              fullWidth
              disabled={!username.trim()}
            >
              Join Chat
            </Button>
          </Box>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ height: '100vh', py: 2 }}>
      <Paper elevation={3} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', height: '100%' }}>
          <Box sx={{ width: '70%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: 2, bgcolor: 'primary.main', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">Offline Messenger</Typography>
              {isVideoEnabled && (
                <IconButton color="inherit" onClick={endVideoCall}>
                  <CallEndIcon />
                </IconButton>
              )}
            </Box>
            {isVideoEnabled && (
              <Box sx={{ display: 'flex', gap: 2, p: 2, bgcolor: 'grey.100' }}>
                <Box sx={{ width: '50%' }}>
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{ 
                      width: '100%', 
                      borderRadius: '8px', 
                      backgroundColor: '#000',
                      transform: 'scaleX(-1)'
                    }}
                  />
                </Box>
                <Box sx={{ width: '50%' }}>
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    style={{ 
                      width: '100%', 
                      borderRadius: '8px', 
                      backgroundColor: '#000'
                    }}
                  />
                </Box>
              </Box>
            )}
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
              {messages.map((msg, index) => (
                <Box key={index} sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {msg.user} - {msg.time}
                  </Typography>
                  <Typography>{msg.text}</Typography>
                </Box>
              ))}
              <div ref={messagesEndRef} />
            </Box>
            <Box component="form" onSubmit={handleSendMessage} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message..."
                  variant="outlined"
                  fullWidth
                />
                <Button type="submit" variant="contained">
                  Send
                </Button>
              </Box>
            </Box>
          </Box>
          <Box sx={{ width: '30%', borderLeft: 1, borderColor: 'divider' }}>
            <Box sx={{ p: 2, bgcolor: 'primary.main', color: 'white' }}>
              <Typography variant="h6">Online Users</Typography>
            </Box>
            <List>
              {users.map((user) => (
                <ListItem 
                  key={user.id}
                  secondaryAction={
                    !isVideoEnabled && user.id !== socket?.id && (
                      <IconButton edge="end" onClick={() => startVideoCall(user.id)}>
                        <VideocamIcon />
                      </IconButton>
                    )
                  }
                >
                  <ListItemText primary={user.username} />
                </ListItem>
              ))}
            </List>
          </Box>
        </Box>
      </Paper>
      <Snackbar 
        open={!!error} 
        autoHideDuration={6000} 
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setError(null)} severity="error">
          {error}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default App; 