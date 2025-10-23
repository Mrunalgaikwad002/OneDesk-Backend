const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const workspaceRoutes = require('./routes/workspaces');
const taskRoutes = require('./routes/tasks');
const chatRoutes = require('./routes/chat');
const documentRoutes = require('./routes/documents');

const { setupSocketHandlers } = require('./socket/socketHandlers');
const { setupWebRTCHandlers } = require('./socket/webrtcHandlers');
const { setupYWebSocket } = require('./yjs/yWebSocketServer');

const app = express();
const server = http.createServer(app);

// Compute allowed CORS origins from ENV (supports comma-separated list)
const defaultOrigins = [
  'http://localhost:3000',
  'https://one-desk.netlify.app',
  'https://one-desk-rust.vercel.app'
];
const envOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = envOrigins.length ? envOrigins : defaultOrigins;

// Build CORS options with explicit methods/headers and dynamic origin check
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser tools
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Security middleware
app.use(helmet());

// CORS (must be before routes)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate limiting (skip preflight)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  skip: (req) => req.method === 'OPTIONS'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/documents', documentRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'Remote Work Collaboration Backend' });
});

// Setup Socket.io handlers
setupSocketHandlers(io);

// Setup WebRTC handlers
setupWebRTCHandlers(io);

// Setup Y-WebSocket server for document collaboration
setupYWebSocket(server);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.io server ready for connections`);
  console.log(`📝 Y-WebSocket server ready for document collaboration`);

  console.log('Allowed CORS origins:', allowedOrigins);
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
  console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Loaded ✅' : 'Missing ❌');
});

module.exports = { app, server, io };
