const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');

// Store document access permissions
const documentPermissions = new Map(); // documentId -> Set of userIds with access

const setupYWebSocket = (server) => {
  const wss = new WebSocketServer({ 
    port: 1234,
    path: '/yjs'
  });

  console.log('📝 Y-WebSocket server running on port 1234');

  wss.on('connection', async (ws, req) => {
    try {
      // Extract token from query parameters or headers
      const token = req.url.split('token=')[1] || req.headers.authorization?.split(' ')[1];
      
      if (!token) {
        ws.close(1008, 'Authentication required');
        return;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from database
      const { data: user, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name')
        .eq('id', decoded.userId)
        .single();

      if (error || !user) {
        ws.close(1008, 'User not found');
        return;
      }

      // Extract document ID from URL path
      const url = new URL(req.url, `http://${req.headers.host}`);
      const documentId = url.searchParams.get('documentId');

      if (!documentId) {
        ws.close(1008, 'Document ID required');
        return;
      }

      // Verify user has access to the document
      const { data: access, error: accessError } = await supabaseAdmin
        .from('document_collaborators')
        .select('permission')
        .eq('document_id', documentId)
        .eq('user_id', user.id)
        .single();

      if (accessError || !access) {
        ws.close(1008, 'No access to this document');
        return;
      }

      // Store user access for this document
      if (!documentPermissions.has(documentId)) {
        documentPermissions.set(documentId, new Set());
      }
      documentPermissions.get(documentId).add(user.id);

      // Add user info to the WebSocket
      ws.userId = user.id;
      ws.user = user;
      ws.documentId = documentId;
      ws.permission = access.permission;

      console.log(`User ${user.email} connected to document ${documentId} with ${access.permission} permission`);

      // Handle document updates
      ws.on('message', async (message) => {
        try {
          // Parse the Yjs update message
          const update = new Uint8Array(message);
          
          // Save document snapshot periodically (every 10 updates or 30 seconds)
          if (!ws.updateCount) ws.updateCount = 0;
          if (!ws.lastSave) ws.lastSave = Date.now();
          
          ws.updateCount++;
          const shouldSave = ws.updateCount % 10 === 0 || (Date.now() - ws.lastSave) > 30000;
          
          if (shouldSave) {
            await saveDocumentSnapshot(documentId, update, user.id);
            ws.lastSave = Date.now();
          }
        } catch (error) {
          console.error('Error processing document update:', error);
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        console.log(`User ${user.email} disconnected from document ${documentId}`);
        
        // Remove user from document permissions
        const users = documentPermissions.get(documentId);
        if (users) {
          users.delete(user.id);
          if (users.size === 0) {
            documentPermissions.delete(documentId);
          }
        }
      });

      // Set up Yjs connection
      setupWSConnection(ws, req, {
        // Custom document name based on document ID
        docName: `document-${documentId}`,
        
        // Custom persistence handler
        persistence: {
          bindState: async (docName, ydoc) => {
            try {
              // Load document from database
              const { data: document, error } = await supabaseAdmin
                .from('documents')
                .select('content')
                .eq('id', documentId)
                .single();

              if (!error && document && document.content) {
                // Apply the stored state to the Y.Doc
                const update = new Uint8Array(document.content);
                const Y = require('yjs');
                Y.applyUpdate(ydoc, update);
              }
            } catch (error) {
              console.error('Error loading document state:', error);
            }
          },
          
          writeState: async (docName, ydoc) => {
            try {
              // Save document state to database
              const state = Y.encodeStateAsUpdate(ydoc);
              await saveDocumentSnapshot(documentId, state, user.id);
            } catch (error) {
              console.error('Error saving document state:', error);
            }
          }
        }
      });

    } catch (error) {
      console.error('Y-WebSocket connection error:', error);
      ws.close(1008, 'Authentication failed');
    }
  });

  // Cleanup function
  const cleanup = () => {
    wss.close();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return wss;
};

// Helper function to save document snapshot
const saveDocumentSnapshot = async (documentId, update, userId) => {
  try {
    const { error } = await supabaseAdmin
      .from('documents')
      .update({
        content: Array.from(update),
        last_modified_by: userId,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);

    if (error) {
      console.error('Error saving document snapshot:', error);
    }
  } catch (error) {
    console.error('Error in saveDocumentSnapshot:', error);
  }
};

// Helper function to get document collaborators
const getDocumentCollaborators = (documentId) => {
  return Array.from(documentPermissions.get(documentId) || []);
};

// Helper function to check if user has access to document
const hasDocumentAccess = (documentId, userId) => {
  const users = documentPermissions.get(documentId);
  return users ? users.has(userId) : false;
};

module.exports = {
  setupYWebSocket,
  getDocumentCollaborators,
  hasDocumentAccess
};
