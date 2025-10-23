# OneDesk Backend

Express-based backend powering OneDesk: auth, workspaces, chat, tasks, collaborative docs, whiteboard sync, and WebRTC signaling. Deployed on Render; consumable from Netlify/Vercel frontends.

## Features
- JWT auth (login/register) with bcrypt
- Workspaces (create/list/get), membership checks
- Chat: rooms, messages, members, pagination
- Tasks: boards, lists, tasks, drag/drop reorder & cross‑list moves
- Documents: Yjs snapshots + y‑websocket bridge
- Realtime with Socket.io (chat, tasks, whiteboard, presence)
- WebRTC signaling (simple‑peer) events
- CORS, Helmet, rate limiting, health endpoints
- Demo fallbacks for chat/messages when DB is unavailable

## Tech Stack
- Node.js, Express, Socket.io
- Supabase (DB + storage; queries via supabase-js)
- JSON Web Tokens (JWT)
- y-websocket (collab docs transport)

## Project Structure (key files)
- `server.js` — app bootstrap, CORS, routes, Socket.io
- `routes/` — REST endpoints:
  - `auth.js`, `users.js`, `workspaces.js`, `tasks.js`, `chat.js`, `documents.js`
- `socket/` — Socket.io handlers:
  - `socketHandlers.js`, `webrtcHandlers.js`
- `yjs/` — Y-WebSocket bridge (if present)
- `api/index.js` — Serverless entry for Vercel (optional)

## Environment Variables
Set these in your hosting provider (Render) or `.env` locally:
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase service role key
- `JWT_SECRET` — Secret for signing JWTs
- `NODE_ENV` — `development` | `production`
- `FRONTEND_URL` — e.g. `https://one-desk.netlify.app`
- Do NOT set a fixed `PORT` on Render (Render injects `PORT`). Locally you may use `PORT=5000`.

## Install & Run (local)
```bash
cd backend
npm install
# create .env with the variables above
npm start  # starts on http://localhost:5000 by default
```

Health checks:
- `GET /api/health` → `{ status: 'OK', ... }`
- `GET /` → service banner

## CORS
Configured in `server.js`:
- Allows `FRONTEND_URL` and localhost. For Netlify: add `https://one-desk.netlify.app`.
- Socket.io CORS mirrors the same origins.

## REST Endpoints (overview)
Auth (`/api/auth`)
- `POST /login` — email/password → `{ token }`
- `POST /register` — create user → `{ token, user }`
- `POST /oauth` — exchange Supabase OAuth → app JWT

Users (`/api/users`)
- Basic profile/query helpers (as implemented)

Workspaces (`/api/workspaces`)
- `GET /` — list my workspaces
- `POST /` — create workspace `{ name }`
- `GET /:id` — workspace details

Chat (`/api/chat`)
- `GET /workspace/:workspaceId/rooms` — list rooms (demo fallback on DB error)
- `POST /workspace/:workspaceId/rooms` — create room
- `GET /rooms/:roomId/messages?page&limit` — paginated messages (demo fallback on access error)
- `GET /rooms/:roomId/members`
- `POST /rooms/:roomId/members` — add member
- `DELETE /rooms/:roomId/members/:userId` — remove member

Tasks (`/api/tasks`)
- Boards
  - `GET /workspace/:workspaceId/boards`
  - `POST /workspace/:workspaceId/boards` — create board
- Lists
  - `POST /boards/:boardId/lists` — create list
- Tasks
  - `POST /lists/:listId/tasks` — create task
  - `PUT /tasks/:taskId` — update (supports `listId` to move across lists)
  - `DELETE /tasks/:taskId`
  - Reordering endpoints as implemented in file

Documents (`/api/documents`)
- `GET /workspace/:workspaceId` — list documents
- `POST /workspace/:workspaceId` — create doc `{ title }`
- `POST /:documentId/collaborators` — add collaborator `{ userId, permission }`
- Additional CRUD as implemented

## Socket.io Events (high level)
Namespace: default
- Auth/presence: join/leave workspace rooms, user presence
- Chat: `join_room`, `leave_room`, `typing`, `send_message`, broadcast to room
- Tasks: `task_created`, `task_updated`, `task_moved`, `task_deleted`, `list_created`
- Whiteboard: `wb_begin`, `wb_draw`, `wb_line`, `wb_clear`
- WebRTC signaling: `start_call`, `accept_call`, `reject_call`, `end_call`, `call_signal`, `user_joined_call`, `user_left_call`

See `socket/socketHandlers.js` and `socket/webrtcHandlers.js` for exact payloads.

## y-websocket (Docs Collaboration)
Frontend connects to: `wss://onedesk-backend.onrender.com` via `y-websocket` (`document-<id>` rooms). Backend bridges Yjs updates; documents API can store snapshots/metadata in Supabase.

## Deployment (Render)
1. Push code to GitHub
2. Create a Render Web Service pointing to `backend/`
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Set env vars: `SUPABASE_URL`, `SUPABASE_KEY`, `JWT_SECRET`, `NODE_ENV=production`, `FRONTEND_URL=https://one-desk.netlify.app`
6. Do NOT set a fixed `PORT`; Render injects `PORT`.

Serverless (Vercel) optional: `backend/api/index.js` exports the Express app.

## Troubleshooting
- CORS blocked
  - Ensure `FRONTEND_URL` includes your deployed site (e.g., Netlify URL) and that `server.js` CORS arrays include it for both Express and Socket.io.
- 403 “Not a workspace member”
  - Use demo workspace/rooms in frontend or ensure membership rows exist in DB.
- Supabase “failed to parse order”
  - Ordering on nested tables was removed in `chat.js`.
- Chat returns 500/403
  - `chat.js` falls back to demo rooms/messages to prevent hard failures.
- Netlify/Vercel preflight failing
  - Confirm `Access-Control-Allow-Origin` matches exact frontend origin, and `credentials: true` only if cookies are used.

## Scripts
```json
{
  "start": "node server.js"
}
```

## License
MIT
