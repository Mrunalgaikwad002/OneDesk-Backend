const { Server } = require('socket.io');
const readline = require('readline');

// Create Socket.io server
const io = new Server(8080, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let clientSocket = null;

console.log('🖥️  Server started on port 8080');
console.log('Waiting for client to connect...\n');

// Handle client connections
io.on('connection', (socket) => {
  clientSocket = socket;
  console.log('✅ Client connected!');
  console.log('You can now start chatting. Type your message and press Enter.\n');
 
  // Handle incoming messages from client
  socket.on('message', (data) => {
    console.log(`📱 Client: ${data.message}`);
  });
 
  // Handle client disconnect
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected');
    clientSocket = null;
  });
 
  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Function to send message to client
function sendMessage(message) {
  if (clientSocket) {
    clientSocket.emit('message', { message: message });
    console.log(`🖥️  You: ${message}`);
  } else {
    console.log('❌ No client connected');
  }
}

// Handle user input
rl.on('line', (input) => {
  if (input.trim() === '') return;
 
  if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
    console.log('👋 Server shutting down...');
    if (clientSocket) {
      clientSocket.disconnect();
    }
    process.exit(0);
  }
 
  sendMessage(input);
});

// Handle server shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Server shutting down...');
  if (clientSocket) {
    clientSocket.disconnect();
  }
  io.close();
  process.exit(0);
});

console.log('Commands:');
console.log('- Type any message and press Enter to send');
console.log('- Type "quit" or "exit" to close the server');
console.log('- Press Ctrl+C to force quit\n');
