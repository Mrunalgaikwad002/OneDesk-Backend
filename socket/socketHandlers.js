const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { setupWebRTCHandlers } = require('./webrtcHandlers');

// Store active connections
const activeConnections = new Map(); // userId -> Set of socketIds
const workspaceRooms = new Map(); // workspaceId -> Set of userIds
const userPresence = new Map(); // userId -> { status, workspaceId, lastSeen }

const setupSocketHandlers = (io) => {
  // Setup WebRTC handlers
  setupWebRTCHandlers(io);
  
  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from database
      const { data: user, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .eq('id', decoded.userId)
        .single();

      if (error || !user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.email} connected with socket ${socket.id}`);

    // Add to active connections
    if (!activeConnections.has(socket.userId)) {
      activeConnections.set(socket.userId, new Set());
    }
    activeConnections.get(socket.userId).add(socket.id);

    // Join user to their personal room for direct signaling
    socket.join(`user:${socket.userId}`);

    // Join user to their workspaces
    socket.on('join_workspaces', async (workspaceIds) => {
      try {
        // Verify user is member of these workspaces
        const { data: memberships, error } = await supabaseAdmin
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', socket.userId)
          .in('workspace_id', workspaceIds);

        if (error) {
          socket.emit('error', { message: 'Failed to verify workspace memberships' });
          return;
        }

        const validWorkspaceIds = memberships.map(m => m.workspace_id);

        // Join socket to workspace rooms
        validWorkspaceIds.forEach(workspaceId => {
          socket.join(`workspace:${workspaceId}`);
          
          // Add to workspace rooms tracking
          if (!workspaceRooms.has(workspaceId)) {
            workspaceRooms.set(workspaceId, new Set());
          }
          workspaceRooms.get(workspaceId).add(socket.userId);

          // Update presence
          updateUserPresence(socket.userId, workspaceId, 'online');
        });

        // Notify workspace members about user coming online
        validWorkspaceIds.forEach(workspaceId => {
          socket.to(`workspace:${workspaceId}`).emit('user_online', {
            userId: socket.userId,
            user: socket.user,
            workspaceId
          });
        });

        socket.emit('workspaces_joined', { workspaceIds: validWorkspaceIds });
      } catch (error) {
        console.error('Join workspaces error:', error);
        socket.emit('error', { message: 'Failed to join workspaces' });
      }
    });

    // Handle chat messages
    socket.on('send_message', async (data) => {
      try {
        const { roomId, content, messageType = 'text', metadata } = data;

        // Verify user is member of the chat room
        const { data: membership, error } = await supabaseAdmin
          .from('chat_room_members')
          .select('room_id')
          .eq('room_id', roomId)
          .eq('user_id', socket.userId)
          .single();

        if (error || !membership) {
          socket.emit('error', { message: 'Not a member of this chat room' });
          return;
        }

        // Save message to database
        const { data: message, error: messageError } = await supabaseAdmin
          .from('messages')
          .insert({
            room_id: roomId,
            sender_id: socket.userId,
            content,
            message_type: messageType,
            metadata
          })
          .select(`
            id,
            content,
            message_type,
            metadata,
            created_at,
            profiles:sender_id (
              id,
              email,
              full_name,
              avatar_url
            )
          `)
          .single();

        if (messageError) {
          socket.emit('error', { message: 'Failed to send message' });
          return;
        }

        // Broadcast message to room members
        io.to(`room:${roomId}`).emit('new_message', {
          id: message.id,
          content: message.content,
          messageType: message.message_type,
          metadata: message.metadata,
          createdAt: message.created_at,
          sender: message.profiles
        });

      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle joining chat room
    socket.on('join_chat_room', async (roomId) => {
      try {
        // Verify user is member of the chat room
        const { data: membership, error } = await supabaseAdmin
          .from('chat_room_members')
          .select('room_id')
          .eq('room_id', roomId)
          .eq('user_id', socket.userId)
          .single();

        if (error || !membership) {
          socket.emit('error', { message: 'Not a member of this chat room' });
          return;
        }

        socket.join(`room:${roomId}`);
        socket.emit('chat_room_joined', { roomId });
      } catch (error) {
        console.error('Join chat room error:', error);
        socket.emit('error', { message: 'Failed to join chat room' });
      }
    });

    // Handle leaving chat room
    socket.on('leave_chat_room', (roomId) => {
      socket.leave(`room:${roomId}`);
      socket.emit('chat_room_left', { roomId });
    });

    // Handle task board operations
    socket.on('join_task_board', async (data) => {
      try {
        const { boardId } = data;

        // Verify user has access to the board
        const { data: board, error } = await supabaseAdmin
          .from('task_boards')
          .select(`
            workspace_id,
            workspace_members:workspace_id!inner(user_id)
          `)
          .eq('id', boardId)
          .eq('workspace_members.user_id', socket.userId)
          .single();

        if (error || !board) {
          socket.emit('error', { message: 'Access denied to task board' });
          return;
        }

        socket.join(`board:${boardId}`);
        socket.emit('task_board_joined', { boardId });

      } catch (error) {
        console.error('Join task board error:', error);
        socket.emit('error', { message: 'Failed to join task board' });
      }
    });

    socket.on('leave_task_board', (boardId) => {
      socket.leave(`board:${boardId}`);
      socket.emit('task_board_left', { boardId });
    });

    // Real-time task operations
    socket.on('task_created', async (data) => {
      try {
        const { boardId, listId, task } = data;

        // Verify access
        const { data: board, error } = await supabaseAdmin
          .from('task_boards')
          .select('workspace_id')
          .eq('id', boardId)
          .single();

        if (error || !board) return;

        const { data: membership } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', board.workspace_id)
          .eq('user_id', socket.userId)
          .single();

        if (!membership) return;

        // Broadcast to board members
        socket.to(`board:${boardId}`).emit('task_created', {
          boardId,
          listId,
          task,
          createdBy: socket.user
        });

      } catch (error) {
        console.error('Task created broadcast error:', error);
      }
    });

    socket.on('task_updated', async (data) => {
      try {
        const { boardId, taskId, updates } = data;

        // Verify access
        const { data: board, error } = await supabaseAdmin
          .from('task_boards')
          .select('workspace_id')
          .eq('id', boardId)
          .single();

        if (error || !board) return;

        const { data: membership } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', board.workspace_id)
          .eq('user_id', socket.userId)
          .single();

        if (!membership) return;

        // Broadcast to board members
        socket.to(`board:${boardId}`).emit('task_updated', {
          boardId,
          taskId,
          updates,
          updatedBy: socket.user
        });

      } catch (error) {
        console.error('Task updated broadcast error:', error);
      }
    });

    socket.on('task_moved', async (data) => {
      try {
        const { boardId, taskId, sourceListId, destinationListId, sourceIndex, destinationIndex } = data;

        // Verify access
        const { data: board, error } = await supabaseAdmin
          .from('task_boards')
          .select('workspace_id')
          .eq('id', boardId)
          .single();

        if (error || !board) return;

        const { data: membership } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', board.workspace_id)
          .eq('user_id', socket.userId)
          .single();

        if (!membership) return;

        // Broadcast to board members
        socket.to(`board:${boardId}`).emit('task_moved', {
          boardId,
          taskId,
          sourceListId,
          destinationListId,
          sourceIndex,
          destinationIndex,
          movedBy: socket.user
        });

      } catch (error) {
        console.error('Task moved broadcast error:', error);
      }
    });

    socket.on('task_deleted', async (data) => {
      try {
        const { boardId, taskId, listId } = data;

        // Verify access
        const { data: board, error } = await supabaseAdmin
          .from('task_boards')
          .select('workspace_id')
          .eq('id', boardId)
          .single();

        if (error || !board) return;

        const { data: membership } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', board.workspace_id)
          .eq('user_id', socket.userId)
          .single();

        if (!membership) return;

        // Broadcast to board members
        socket.to(`board:${boardId}`).emit('task_deleted', {
          boardId,
          taskId,
          listId,
          deletedBy: socket.user
        });

      } catch (error) {
        console.error('Task deleted broadcast error:', error);
      }
    });

    socket.on('list_created', async (data) => {
      try {
        const { boardId, list } = data;

        // Verify access
        const { data: board, error } = await supabaseAdmin
          .from('task_boards')
          .select('workspace_id')
          .eq('id', boardId)
          .single();

        if (error || !board) return;

        const { data: membership } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', board.workspace_id)
          .eq('user_id', socket.userId)
          .single();

        if (!membership) return;

        // Broadcast to board members
        socket.to(`board:${boardId}`).emit('list_created', {
          boardId,
          list,
          createdBy: socket.user
        });

      } catch (error) {
        console.error('List created broadcast error:', error);
      }
    });

    // Handle document collaboration
    socket.on('document_join', async (data) => {
      try {
        const { documentId, workspaceId } = data;

        // Verify user has access to the document
        const { data: access, error } = await supabaseAdmin
          .from('document_collaborators')
          .select('permission')
          .eq('document_id', documentId)
          .eq('user_id', socket.userId)
          .single();

        if (error || !access) {
          socket.emit('error', { message: 'No access to this document' });
          return;
        }

        socket.join(`document:${documentId}`);
        socket.emit('document_joined', { documentId });

        // Notify other collaborators
        socket.to(`document:${documentId}`).emit('collaborator_joined', {
          userId: socket.userId,
          user: socket.user
        });

      } catch (error) {
        console.error('Document join error:', error);
        socket.emit('error', { message: 'Failed to join document' });
      }
    });

    // Handle document leave
    socket.on('document_leave', (documentId) => {
      socket.leave(`document:${documentId}`);
      socket.to(`document:${documentId}`).emit('collaborator_left', {
        userId: socket.userId,
        user: socket.user
      });
    });

    // Whiteboard realtime sync (Konva/canvas)
    socket.on('wb_begin', (data) => {
      const { workspaceId, x, y, color, size } = data || {};
      if (!workspaceId) return;
      socket.to(`workspace:${workspaceId}`).emit('wb_begin', { x, y, color, size });
    });

    socket.on('wb_draw', (data) => {
      const { workspaceId, x, y } = data || {};
      if (!workspaceId) return;
      socket.to(`workspace:${workspaceId}`).emit('wb_draw', { x, y });
    });

    socket.on('wb_line', (data) => {
      const { workspaceId, points, color, size } = data || {};
      if (!workspaceId) return;
      socket.to(`workspace:${workspaceId}`).emit('wb_line', { points, color, size });
    });

    // WebRTC signaling is now handled by webrtcHandlers.js

    // Handle presence updates
    socket.on('update_presence', async (data) => {
      try {
        const { workspaceId, status } = data;

        // Verify user is member of workspace
        const { data: membership, error } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('user_id', socket.userId)
          .single();

        if (error || !membership) {
          return;
        }

        updateUserPresence(socket.userId, workspaceId, status);

        // Broadcast presence update
        socket.to(`workspace:${workspaceId}`).emit('presence_updated', {
          userId: socket.userId,
          user: socket.user,
          status,
          workspaceId
        });

      } catch (error) {
        console.error('Update presence error:', error);
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      const { roomId } = data;
      socket.to(`room:${roomId}`).emit('user_typing', {
        userId: socket.userId,
        user: socket.user,
        isTyping: true
      });
    });

    socket.on('typing_stop', (data) => {
      const { roomId } = data;
      socket.to(`room:${roomId}`).emit('user_typing', {
        userId: socket.userId,
        user: socket.user,
        isTyping: false
      });
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`User ${socket.user.email} disconnected`);

      // Remove from active connections
      const userConnections = activeConnections.get(socket.userId);
      if (userConnections) {
        userConnections.delete(socket.id);
        if (userConnections.size === 0) {
          activeConnections.delete(socket.userId);
          
          // Update presence to offline for all workspaces
          const workspaces = Array.from(workspaceRooms.entries())
            .filter(([_, userIds]) => userIds.has(socket.userId))
            .map(([workspaceId, _]) => workspaceId);

          workspaces.forEach(workspaceId => {
            updateUserPresence(socket.userId, workspaceId, 'offline');
            
            // Notify workspace members
            socket.to(`workspace:${workspaceId}`).emit('user_offline', {
              userId: socket.userId,
              user: socket.user,
              workspaceId
            });

            // Remove from workspace rooms
            const workspaceUsers = workspaceRooms.get(workspaceId);
            if (workspaceUsers) {
              workspaceUsers.delete(socket.userId);
              if (workspaceUsers.size === 0) {
                workspaceRooms.delete(workspaceId);
              }
            }
          });
        }
      }
    });
  });
};

// Helper function to update user presence
const updateUserPresence = async (userId, workspaceId, status) => {
  try {
    userPresence.set(userId, {
      status,
      workspaceId,
      lastSeen: new Date().toISOString()
    });

    // Update in database
    await supabaseAdmin
      .from('user_presence')
      .upsert({
        user_id: userId,
        workspace_id: workspaceId,
        status,
        last_seen: new Date().toISOString()
      });
  } catch (error) {
    console.error('Update presence error:', error);
  }
};

// Helper function to get online users in a workspace
const getOnlineUsers = (workspaceId) => {
  const userIds = workspaceRooms.get(workspaceId) || new Set();
  return Array.from(userIds).filter(userId => {
    const presence = userPresence.get(userId);
    return presence && presence.status === 'online';
  });
};

module.exports = {
  setupSocketHandlers,
  getOnlineUsers,
  activeConnections,
  userPresence
};
