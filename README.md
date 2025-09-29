# Remote Work Collaboration Suite - Backend

A comprehensive backend API for real-time collaboration features including document editing, video conferencing, task management, and team chat.

## 🚀 Features

- **Authentication & Authorization**: JWT-based auth with Supabase integration
- **Real-time Communication**: Socket.io for live updates and WebRTC for video calls
- **Document Collaboration**: Yjs-based real-time collaborative editing
- **Task Management**: Kanban-style task boards with real-time updates
- **Team Chat**: Persistent messaging with typing indicators
- **User Management**: Workspace-based user roles and permissions
- **File Uploads**: Cloudinary integration for profile pictures and documents

## 🛠 Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **Real-time**: Socket.io, Y-WebSocket
- **Authentication**: JWT + Supabase Auth
- **File Storage**: Cloudinary
- **Validation**: express-validator

## 📋 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Supabase account and project
- Cloudinary account (optional, for file uploads)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp env.example .env
   ```
   
   Fill in your environment variables:
   ```env
   # Server Configuration
   PORT=5000
   NODE_ENV=development

   # Supabase Configuration
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

   # JWT Configuration
   JWT_SECRET=your_jwt_secret_key_here
   JWT_EXPIRES_IN=7d

   # Cloudinary Configuration (optional)
   CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
   CLOUDINARY_API_KEY=your_cloudinary_api_key
   CLOUDINARY_API_SECRET=your_cloudinary_api_secret

   # CORS Configuration
   FRONTEND_URL=http://localhost:3000
   ```

4. **Database Setup**
   - Create a new Supabase project
   - Run the SQL schema from `database/schema.sql` in your Supabase SQL editor
   - Enable Row Level Security (RLS) policies as defined in the schema

5. **Start the server**
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update user profile
- `POST /api/auth/logout` - Logout user
- `POST /api/auth/refresh` - Refresh JWT token

### Workspaces
- `GET /api/workspaces` - Get user's workspaces
- `POST /api/workspaces` - Create workspace
- `GET /api/workspaces/:id` - Get workspace details
- `PUT /api/workspaces/:id` - Update workspace
- `DELETE /api/workspaces/:id` - Delete workspace
- `POST /api/workspaces/:id/invite` - Invite user to workspace
- `POST /api/workspaces/:id/leave` - Leave workspace

### Users
- `GET /api/users/search` - Search users
- `GET /api/users/:id` - Get user profile
- `GET /api/users/workspace/:id/members` - Get workspace members
- `PUT /api/users/workspace/:id/members/:memberId/role` - Update member role
- `DELETE /api/users/workspace/:id/members/:memberId` - Remove member

### Chat
- `GET /api/chat/workspace/:id/rooms` - Get chat rooms
- `POST /api/chat/workspace/:id/rooms` - Create chat room
- `GET /api/chat/rooms/:id/messages` - Get messages
- `GET /api/chat/rooms/:id/members` - Get room members
- `POST /api/chat/rooms/:id/members` - Add member to room
- `DELETE /api/chat/rooms/:id/members/:memberId` - Remove member from room
- `DELETE /api/chat/rooms/:id` - Delete chat room

### Tasks
- `GET /api/tasks/workspace/:id/boards` - Get task boards
- `POST /api/tasks/workspace/:id/boards` - Create task board
- `GET /api/tasks/boards/:id` - Get board with tasks
- `POST /api/tasks/boards/:id/lists` - Create task list
- `POST /api/tasks/lists/:id/tasks` - Create task
- `PUT /api/tasks/tasks/:id` - Update task
- `DELETE /api/tasks/tasks/:id` - Delete task
- `PUT /api/tasks/lists/:id/reorder` - Reorder tasks

### Documents
- `GET /api/documents/workspace/:id` - Get workspace documents
- `POST /api/documents/workspace/:id` - Create document
- `GET /api/documents/:id` - Get document details
- `PUT /api/documents/:id` - Update document
- `DELETE /api/documents/:id` - Delete document
- `POST /api/documents/:id/collaborators` - Add collaborator
- `PUT /api/documents/:id/collaborators/:collaboratorId` - Update collaborator permission
- `DELETE /api/documents/:id/collaborators/:collaboratorId` - Remove collaborator
- `GET /api/documents/:id/collaborators` - Get document collaborators

## 🔌 WebSocket Events

### Connection
- `join_workspaces` - Join workspace rooms
- `join_user_room` - Join personal room for direct messaging

### Chat
- `send_message` - Send chat message
- `join_chat_room` - Join chat room
- `leave_chat_room` - Leave chat room
- `typing_start` - Start typing indicator
- `typing_stop` - Stop typing indicator

### Tasks
- `task_updated` - Broadcast task updates

### Documents
- `document_join` - Join document collaboration
- `document_leave` - Leave document collaboration

### Video Calls
- `start_video_call` - Start 1:1 video call
- `accept_call` - Accept incoming call
- `reject_call` - Reject incoming call
- `end_call` - End active call
- `join_group_call` - Join group video call
- `leave_group_call` - Leave group video call
- `webrtc_offer` - WebRTC offer
- `webrtc_answer` - WebRTC answer
- `webrtc_ice_candidate` - WebRTC ICE candidate

### Presence
- `update_presence` - Update user presence status

## 📝 Document Collaboration

The backend includes a Y-WebSocket server running on port 1234 for real-time document collaboration:

- **Endpoint**: `ws://localhost:1234/yjs?token=<jwt_token>&documentId=<document_id>`
- **Features**: Real-time collaborative editing with conflict resolution
- **Storage**: Automatic document snapshots saved to database
- **Permissions**: Read/Write/Admin access levels

## 🔒 Security Features

- JWT-based authentication
- Row Level Security (RLS) in Supabase
- Rate limiting (100 requests per 15 minutes)
- CORS protection
- Helmet.js security headers
- Input validation with express-validator
- Workspace and document access controls

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## 🚀 Deployment

### Environment Variables for Production
- Set `NODE_ENV=production`
- Use strong JWT secrets
- Configure proper CORS origins
- Set up SSL certificates
- Configure database connection pooling

### Recommended Platforms
- **Backend**: Railway, Render, or Heroku
- **Database**: Supabase (managed PostgreSQL)
- **File Storage**: Cloudinary
- **Monitoring**: Consider adding logging and monitoring services

## 📊 Database Schema

The database includes the following main tables:
- `profiles` - User profiles
- `workspaces` - Workspace information
- `workspace_members` - Workspace membership and roles
- `task_boards` - Task board definitions
- `task_lists` - Task list definitions
- `tasks` - Individual tasks
- `chat_rooms` - Chat room definitions
- `chat_room_members` - Chat room membership
- `messages` - Chat messages
- `documents` - Document metadata
- `document_collaborators` - Document access permissions
- `user_presence` - User online/offline status

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the API documentation
- Review the database schema
- Test with the provided endpoints
