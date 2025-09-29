# Socket.io Testing Files

This directory contains simple Socket.io server and client files for testing real-time communication.

## Files

- `simpleServer.js` - Basic Socket.io server for testing
- `simpleClient.js` - Basic Socket.io client for testing
- `socketHandlers.js` - Main Socket.io handlers for the collaboration suite
- `webrtcHandlers.js` - WebRTC signaling handlers

## Quick Test

### 1. Start the Simple Server
```bash
npm run socket:server
```
This will start a Socket.io server on port 8080.

### 2. Start the Simple Client (in another terminal)
```bash
npm run socket:client
```
This will connect to the server and allow you to send messages.

### 3. Test Communication
- Type messages in either terminal and press Enter
- Messages will be sent between server and client
- Use `quit` or `exit` to close either application

## Commands

### Server Commands:
- Type any message and press Enter to send to client
- Type "quit" or "exit" to close the server
- Press Ctrl+C to force quit

### Client Commands:
- Type any message and press Enter to send to server
- Type "status" to check connection status
- Type "reconnect" to manually reconnect
- Type "quit" or "exit" to close the client
- Press Ctrl+C to force quit

## Integration with Main Backend

The main backend server (`server.js`) uses the more comprehensive Socket.io handlers in:
- `socketHandlers.js` - Handles chat, tasks, documents, presence
- `webrtcHandlers.js` - Handles video call signaling

These simple test files are useful for:
- Testing basic Socket.io connectivity
- Debugging connection issues
- Learning Socket.io basics
- Quick prototyping

## Production vs Testing

- **Simple files**: For testing and learning
- **Main handlers**: For the full collaboration suite with authentication, workspaces, etc.

The main backend runs on port 5000 with Socket.io, while these test files run on port 8080 for isolation.
