const { supabaseAdmin } = require('../config/supabase');

// Store active video calls
const activeCalls = new Map(); // callId -> { participants: Set of userIds, workspaceId, type }
const userCalls = new Map(); // userId -> Set of callIds

const setupWebRTCHandlers = (io) => {
  // Handle video call initiation
  io.on('connection', (socket) => {
    // Join user to their personal room for direct signaling
    socket.on('join_user_room', () => {
      socket.join(`user:${socket.userId}`);
    });

    // Start a video call
    socket.on('start_video_call', async (data) => {
      try {
        const { targetUserId, workspaceId, callType = '1:1' } = data;
        const callerId = socket.userId;

        // Verify both users are in the same workspace
        const { data: callerMembership, error: callerError } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('user_id', callerId)
          .single();

        const { data: targetMembership, error: targetError } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('user_id', targetUserId)
          .single();

        if (callerError || !callerMembership || targetError || !targetMembership) {
          socket.emit('call_error', { message: 'Both users must be in the same workspace' });
          return;
        }

        // Generate unique call ID
        const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create call record
        activeCalls.set(callId, {
          participants: new Set([callerId, targetUserId]),
          workspaceId,
          type: callType,
          startedAt: new Date().toISOString(),
          startedBy: callerId
        });

        // Track user calls
        if (!userCalls.has(callerId)) userCalls.set(callerId, new Set());
        if (!userCalls.has(targetUserId)) userCalls.set(targetUserId, new Set());
        userCalls.get(callerId).add(callId);
        userCalls.get(targetUserId).add(callId);

        // Notify target user about incoming call
        socket.to(`user:${targetUserId}`).emit('incoming_call', {
          callId,
          callerId,
          caller: socket.user,
          workspaceId,
          callType
        });

        // Confirm call started to caller
        socket.emit('call_started', {
          callId,
          targetUserId,
          workspaceId,
          callType
        });

        console.log(`Video call ${callId} started between ${socket.user.email} and user ${targetUserId}`);

      } catch (error) {
        console.error('Start video call error:', error);
        socket.emit('call_error', { message: 'Failed to start video call' });
      }
    });

    // Accept a video call
    socket.on('accept_call', (data) => {
      try {
        const { callId } = data;
        const userId = socket.userId;

        const call = activeCalls.get(callId);
        if (!call || !call.participants.has(userId)) {
          socket.emit('call_error', { message: 'Call not found or access denied' });
          return;
        }

        // Notify all participants that call was accepted
        call.participants.forEach(participantId => {
          io.to(`user:${participantId}`).emit('call_accepted', {
            callId,
            acceptedBy: userId,
            acceptedByUser: socket.user
          });
        });

        console.log(`Call ${callId} accepted by ${socket.user.email}`);

      } catch (error) {
        console.error('Accept call error:', error);
        socket.emit('call_error', { message: 'Failed to accept call' });
      }
    });

    // Reject a video call
    socket.on('reject_call', (data) => {
      try {
        const { callId } = data;
        const userId = socket.userId;

        const call = activeCalls.get(callId);
        if (!call || !call.participants.has(userId)) {
          socket.emit('call_error', { message: 'Call not found or access denied' });
          return;
        }

        // Notify all participants that call was rejected
        call.participants.forEach(participantId => {
          io.to(`user:${participantId}`).emit('call_rejected', {
            callId,
            rejectedBy: userId,
            rejectedByUser: socket.user
          });
        });

        // Clean up call
        cleanupCall(callId);

        console.log(`Call ${callId} rejected by ${socket.user.email}`);

      } catch (error) {
        console.error('Reject call error:', error);
        socket.emit('call_error', { message: 'Failed to reject call' });
      }
    });

    // End a video call
    socket.on('end_call', (data) => {
      try {
        const { callId } = data;
        const userId = socket.userId;

        const call = activeCalls.get(callId);
        if (!call || !call.participants.has(userId)) {
          socket.emit('call_error', { message: 'Call not found or access denied' });
          return;
        }

        // Notify all participants that call ended
        call.participants.forEach(participantId => {
          io.to(`user:${participantId}`).emit('call_ended', {
            callId,
            endedBy: userId,
            endedByUser: socket.user
          });
        });

        // Clean up call
        cleanupCall(callId);

        console.log(`Call ${callId} ended by ${socket.user.email}`);

      } catch (error) {
        console.error('End call error:', error);
        socket.emit('call_error', { message: 'Failed to end call' });
      }
    });

    // Join a group video call
    socket.on('join_group_call', async (data) => {
      try {
        const { workspaceId, callType = 'group' } = data;
        const userId = socket.userId;

        // Verify user is in the workspace
        const { data: membership, error } = await supabaseAdmin
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId)
          .single();

        if (error || !membership) {
          socket.emit('call_error', { message: 'Not a workspace member' });
          return;
        }

        // Find existing group call or create new one
        let callId = null;
        for (const [id, call] of activeCalls.entries()) {
          if (call.workspaceId === workspaceId && call.type === 'group') {
            callId = id;
            break;
          }
        }

        if (!callId) {
          // Create new group call
          callId = `group_call_${workspaceId}_${Date.now()}`;
          activeCalls.set(callId, {
            participants: new Set([userId]),
            workspaceId,
            type: 'group',
            startedAt: new Date().toISOString(),
            startedBy: userId
          });
        } else {
          // Join existing group call
          const call = activeCalls.get(callId);
          call.participants.add(userId);
        }

        // Track user calls
        if (!userCalls.has(userId)) userCalls.set(userId, new Set());
        userCalls.get(userId).add(callId);

        // Join socket to call room
        socket.join(`call:${callId}`);

        // Notify other participants
        socket.to(`call:${callId}`).emit('user_joined_call', {
          callId,
          userId,
          user: socket.user
        });

        // Get current participants
        const call = activeCalls.get(callId);
        const participants = Array.from(call.participants);

        socket.emit('joined_group_call', {
          callId,
          participants,
          workspaceId
        });

        console.log(`${socket.user.email} joined group call ${callId} in workspace ${workspaceId}`);

      } catch (error) {
        console.error('Join group call error:', error);
        socket.emit('call_error', { message: 'Failed to join group call' });
      }
    });

    // Leave a group video call
    socket.on('leave_group_call', (data) => {
      try {
        const { callId } = data;
        const userId = socket.userId;

        const call = activeCalls.get(callId);
        if (!call || !call.participants.has(userId)) {
          socket.emit('call_error', { message: 'Call not found or not a participant' });
          return;
        }

        // Remove user from call
        call.participants.delete(userId);
        socket.leave(`call:${callId}`);

        // Remove from user calls tracking
        const userCallSet = userCalls.get(userId);
        if (userCallSet) {
          userCallSet.delete(callId);
          if (userCallSet.size === 0) {
            userCalls.delete(userId);
          }
        }

        // Notify other participants
        socket.to(`call:${callId}`).emit('user_left_call', {
          callId,
          userId,
          user: socket.user
        });

        // Clean up call if no participants left
        if (call.participants.size === 0) {
          cleanupCall(callId);
        }

        socket.emit('left_group_call', { callId });

        console.log(`${socket.user.email} left group call ${callId}`);

      } catch (error) {
        console.error('Leave group call error:', error);
        socket.emit('call_error', { message: 'Failed to leave group call' });
      }
    });

    // Handle WebRTC signaling
    socket.on('webrtc_offer', (data) => {
      const { targetUserId, offer, callId } = data;
      socket.to(`user:${targetUserId}`).emit('webrtc_offer', {
        fromUserId: socket.userId,
        fromUser: socket.user,
        offer,
        callId
      });
    });

    socket.on('webrtc_answer', (data) => {
      const { targetUserId, answer, callId } = data;
      socket.to(`user:${targetUserId}`).emit('webrtc_answer', {
        fromUserId: socket.userId,
        answer,
        callId
      });
    });

    socket.on('webrtc_ice_candidate', (data) => {
      const { targetUserId, candidate, callId } = data;
      socket.to(`user:${targetUserId}`).emit('webrtc_ice_candidate', {
        fromUserId: socket.userId,
        candidate,
        callId
      });
    });

    // Handle disconnect - clean up calls
    socket.on('disconnect', () => {
      const userId = socket.userId;
      const userCallSet = userCalls.get(userId);

      if (userCallSet) {
        // End all user's calls
        userCallSet.forEach(callId => {
          const call = activeCalls.get(callId);
          if (call) {
            // Notify other participants
            call.participants.forEach(participantId => {
              if (participantId !== userId) {
                io.to(`user:${participantId}`).emit('user_disconnected_from_call', {
                  callId,
                  userId,
                  user: socket.user
                });
              }
            });

            // Remove user from call
            call.participants.delete(userId);

            // Clean up call if no participants left
            if (call.participants.size === 0) {
              cleanupCall(callId);
            }
          }
        });

        userCalls.delete(userId);
      }
    });
  });
};

// Helper function to clean up call
const cleanupCall = (callId) => {
  const call = activeCalls.get(callId);
  if (call) {
    // Remove call from all user tracking
    call.participants.forEach(userId => {
      const userCallSet = userCalls.get(userId);
      if (userCallSet) {
        userCallSet.delete(callId);
        if (userCallSet.size === 0) {
          userCalls.delete(userId);
        }
      }
    });

    activeCalls.delete(callId);
    console.log(`Call ${callId} cleaned up`);
  }
};

// Helper function to get active calls for a user
const getUserActiveCalls = (userId) => {
  const userCallSet = userCalls.get(userId);
  if (!userCallSet) return [];

  return Array.from(userCallSet).map(callId => {
    const call = activeCalls.get(callId);
    return {
      callId,
      participants: Array.from(call.participants),
      workspaceId: call.workspaceId,
      type: call.type,
      startedAt: call.startedAt,
      startedBy: call.startedBy
    };
  });
};

// Helper function to get active calls in a workspace
const getWorkspaceActiveCalls = (workspaceId) => {
  const workspaceCalls = [];
  
  for (const [callId, call] of activeCalls.entries()) {
    if (call.workspaceId === workspaceId) {
      workspaceCalls.push({
        callId,
        participants: Array.from(call.participants),
        type: call.type,
        startedAt: call.startedAt,
        startedBy: call.startedBy
      });
    }
  }

  return workspaceCalls;
};

module.exports = {
  setupWebRTCHandlers,
  getUserActiveCalls,
  getWorkspaceActiveCalls,
  activeCalls,
  userCalls
};
