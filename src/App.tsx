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
  const [isTestingCamera, setIsTestingCamera] = useState(false);
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<Map<string, PeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  useEffect(() => {
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    const initializeVideoElements = () => {
      if (localVideoRef.current) {
        localVideoRef.current.onloadedmetadata = () => {
          console.log('Local video metadata loaded in effect');
          if (localVideoRef.current?.srcObject) {
            console.log('Local video has srcObject:', localVideoRef.current.srcObject);
            localVideoRef.current.play()
              .then(() => console.log('Local video playing'))
              .catch(e => console.error('Error playing local video in effect:', e));
          } else {
            console.error('Local video has no srcObject');
          }
        };
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.onloadedmetadata = () => {
          console.log('Remote video metadata loaded in effect');
          if (remoteVideoRef.current?.srcObject) {
            console.log('Remote video has srcObject:', remoteVideoRef.current.srcObject);
            remoteVideoRef.current.play()
              .then(() => console.log('Remote video playing'))
              .catch(e => console.error('Error playing remote video in effect:', e));
          } else {
            console.error('Remote video has no srcObject');
          }
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
        // First set video enabled to ensure elements are mounted
        setIsVideoEnabled(true);
        setActiveCall(data.from);
        
        // Wait for next render cycle
        await new Promise(resolve => setTimeout(resolve, 100));

        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }, 
          audio: true 
        });
        
        if (!localVideoRef.current) {
          throw new Error('Local video element not found');
        }

        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play();

        const pc = createPeerConnection(data.from);
        stream.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind);
          pc.addTrack(track, stream);
        });

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('Set remote description');
        
        // Flush queued ICE candidates
        const queued = pendingCandidates.current.get(data.from);
        if (queued) {
          for (const candidate of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              console.log('Added queued ICE candidate');
            } catch (error) {
              console.error('Error adding queued ICE candidate:', error);
            }
          }
          pendingCandidates.current.delete(data.from);
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('Created and set local answer');

        socket?.emit('video_answer', {
          target: data.from,
          sdp: answer
        });

        peerConnections.current.set(data.from, { pc, stream });
      } catch (error) {
        console.error('Error handling video offer:', error);
        setError('Failed to start video call: ' + (error as Error).message);
        setIsVideoEnabled(false);
        setActiveCall(null);
        endVideoCall();
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
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          // Queue the candidate if remote description is not set
          if (!pendingCandidates.current.has(data.from)) {
            pendingCandidates.current.set(data.from, []);
          }
          pendingCandidates.current.get(data.from)!.push(data.candidate);
          console.log('Queued ICE candidate');
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('Added ICE candidate');
          } catch (error) {
            console.error('Error handling ICE candidate:', error);
          }
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
    let remoteStream: MediaStream | null = null;
    
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

    pc.ontrack = async (event) => {
      console.log('Received track:', {
        kind: event.track.kind,
        enabled: event.track.enabled,
        muted: event.track.muted,
        readyState: event.track.readyState,
        settings: event.track.getSettings()
      });
      
      if (!remoteVideoRef.current) {
        console.error('Remote video element not found, waiting for mount...');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!remoteVideoRef.current) {
          console.error('Remote video element still not found after wait');
          return;
        }
      }

      // Only set the stream once when we receive the first track
      if (!remoteStream) {
        remoteStream = event.streams[0];
        console.log('Setting remote video stream');
        console.log('Remote stream tracks:', remoteStream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState
        })));
        
        remoteVideoRef.current.srcObject = remoteStream;
        
        try {
          // Wait for metadata to load before playing
          await new Promise((resolve) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.onloadedmetadata = resolve;
            }
          });
          
          await remoteVideoRef.current.play();
          console.log('Remote video playing successfully');
        } catch (e) {
          console.error('Error playing remote video:', e);
        }
      }
    };

    return pc;
  };

  const startVideoCall = async (targetId: string) => {
    console.log('Starting video call with:', targetId);
    try {
      // First set video enabled to ensure elements are mounted
      setIsVideoEnabled(true);
      
      // Wait for next render cycle
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('Requesting media devices...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true,
        audio: true 
      });
      
      console.log('Media devices granted:', {
        videoTracks: stream.getVideoTracks().map(t => ({
          label: t.label,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          settings: t.getSettings()
        })),
        audioTracks: stream.getAudioTracks().map(t => ({
          label: t.label,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState
        }))
      });
      
      if (!localVideoRef.current) {
        throw new Error('Local video element not found');
      }

      console.log('Setting local video stream');
      localVideoRef.current.srcObject = stream;
      
      // Force play the video
      try {
        await localVideoRef.current.play();
        console.log('Local video playing successfully');
      } catch (e) {
        console.error('Error playing local video:', e);
        throw e;
      }

      const pc = createPeerConnection(targetId);
      stream.getTracks().forEach(track => {
        console.log('Adding track to peer connection:', {
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        });
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
    } catch (error) {
      console.error('Error starting video call:', error);
      setError('Failed to start video call: ' + (error as Error).message);
      setIsVideoEnabled(false);
      endVideoCall();
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

  const requestPermissions = async () => {
    try {
      setIsRequestingPermissions(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true,
        audio: true 
      });
      // Stop the stream immediately after getting permissions
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      setError('Camera and microphone permissions are required for video calls. Please grant permissions and try again.');
      return false;
    } finally {
      setIsRequestingPermissions(false);
    }
  };

  const handleJoin = async () => {
    if (username.trim() && socket) {
      try {
        console.log('Requesting camera and microphone permissions...');
        setIsRequestingPermissions(true);
        
        // First check if we already have permissions
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideoPermission = devices.some(device => device.kind === 'videoinput' && device.label);
        const hasAudioPermission = devices.some(device => device.kind === 'audioinput' && device.label);
        
        console.log('Current permissions:', { hasVideoPermission, hasAudioPermission });
        
        if (!hasVideoPermission || !hasAudioPermission) {
          console.log('Requesting new permissions...');
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: true 
          });
          console.log('Permissions granted, stopping test stream');
          // Stop the stream immediately after getting permissions
          stream.getTracks().forEach(track => {
            console.log('Stopping track:', track.kind);
            track.stop();
          });
        } else {
          console.log('Already have permissions');
        }

        console.log('Joining chat...');
        socket.emit('user_join', username);
        setHasJoined(true);
      } catch (error) {
        console.error('Error requesting permissions:', error);
        setError('Camera and microphone permissions are required for video calls. Please grant permissions and try again.');
      } finally {
        setIsRequestingPermissions(false);
      }
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && socket) {
      socket.emit('message', message);
      setMessage('');
    }
  };

  // Add this new useEffect for video element initialization
  useEffect(() => {
    if (isVideoEnabled) {
      const initializeVideos = async () => {
        if (localVideoRef.current && localVideoRef.current.srcObject) {
          try {
            await localVideoRef.current.play();
            console.log('Local video initialized and playing');
          } catch (e) {
            console.error('Error initializing local video:', e);
          }
        }
        
        if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
          try {
            await remoteVideoRef.current.play();
            console.log('Remote video initialized and playing');
          } catch (e) {
            console.error('Error initializing remote video:', e);
          }
        }
      };

      initializeVideos();
    }
  }, [isVideoEnabled]);

  const testCamera = async () => {
    try {
      setIsTestingCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true,
        audio: true 
      });
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play();
        console.log('Camera test successful');
      }
    } catch (error) {
      console.error('Camera test failed:', error);
      setError('Camera test failed: ' + (error as Error).message);
    } finally {
      setIsTestingCamera(false);
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
              disabled={!username.trim() || isRequestingPermissions}
            >
              {isRequestingPermissions ? 'Requesting Permissions...' : 'Join Chat'}
            </Button>
            <Typography variant="caption" color="text.secondary" align="center">
              Camera and microphone permissions are required for video calls
            </Typography>
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
              <Box sx={{ display: 'flex', gap: 1 }}>
                {!isVideoEnabled && (
                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={testCamera}
                    disabled={isTestingCamera}
                    size="small"
                  >
                    Test Camera
                  </Button>
                )}
                {isVideoEnabled && (
                  <IconButton color="inherit" onClick={endVideoCall}>
                    <CallEndIcon />
                  </IconButton>
                )}
              </Box>
            </Box>
            {isVideoEnabled && (
              <Box sx={{ display: 'flex', gap: 2, p: 2, bgcolor: 'grey.100', minHeight: '240px' }}>
                <Box sx={{ width: '50%', position: 'relative', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{ 
                      width: '100%', 
                      height: '240px',
                      borderRadius: '8px', 
                      backgroundColor: '#000',
                      transform: 'scaleX(-1)',
                      objectFit: 'cover'
                    }}
                  />
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      position: 'absolute', 
                      bottom: 8, 
                      left: 8, 
                      color: 'white',
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      padding: '2px 8px',
                      borderRadius: '4px'
                    }}
                  >
                    You
                  </Typography>
                </Box>
                <Box sx={{ width: '50%', position: 'relative', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    style={{ 
                      width: '100%', 
                      height: '240px',
                      borderRadius: '8px', 
                      backgroundColor: '#000',
                      objectFit: 'cover'
                    }}
                  />
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      position: 'absolute', 
                      bottom: 8, 
                      left: 8, 
                      color: 'white',
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      padding: '2px 8px',
                      borderRadius: '4px'
                    }}
                  >
                    Remote
                  </Typography>
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
                    user.id !== socket?.id && (
                      <IconButton 
                        edge="end" 
                        onClick={() => startVideoCall(user.id)}
                        color={isVideoEnabled ? "default" : "primary"}
                        title="Start video call"
                        disabled={isVideoEnabled}
                      >
                        <VideocamIcon />
                      </IconButton>
                    )
                  }
                >
                  <ListItemText 
                    primary={user.username} 
                    secondary={user.id === socket?.id ? "(You)" : ""}
                  />
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