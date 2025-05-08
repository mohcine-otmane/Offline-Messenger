# Offline Messenger

A real-time chat application that works on local networks. Built with React, TypeScript, and Socket.IO.

## Features

- Real-time messaging
- User presence detection
- Clean and modern UI
- Works on local networks
- No internet connection required

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Install server dependencies:
```bash
npm install express socket.io cors
```

2. Install client dependencies:
```bash
npm install
```

## Running the Application

1. Start the server:
```bash
node server.js
```

2. In a new terminal, start the React application:
```bash
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

4. To connect from other devices on the same network, use the host machine's local IP address (e.g., `http://192.168.1.100:3000`)

## Usage

1. Enter your username when prompted
2. Start chatting with other users on the same network
3. See who's online in the users list
4. Messages are delivered in real-time

## Note

Make sure all devices are connected to the same local network to use the application. 