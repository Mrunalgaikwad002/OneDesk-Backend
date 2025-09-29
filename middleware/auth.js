const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from Supabase
    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token or user not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
};

const requireWorkspaceAccess = (requiredRole = 'member') => {
  return async (req, res, next) => {
    try {
      const { workspaceId } = req.params;
      const userId = req.user.id;

      // Check if user is a member of the workspace
      const { data: membership, error } = await supabaseAdmin
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .single();

      if (error || !membership) {
        return res.status(403).json({ error: 'Access denied: Not a workspace member' });
      }

      // Check role permissions
      const roleHierarchy = { member: 1, admin: 2, owner: 3 };
      const userRoleLevel = roleHierarchy[membership.role] || 0;
      const requiredRoleLevel = roleHierarchy[requiredRole] || 1;

      if (userRoleLevel < requiredRoleLevel) {
        return res.status(403).json({ 
          error: `Access denied: Requires ${requiredRole} role or higher` 
        });
      }

      req.workspaceRole = membership.role;
      next();
    } catch (error) {
      console.error('Workspace access check error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
};

const requireDocumentAccess = (permission = 'read') => {
  return async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;

      // Check if user has access to the document
      const { data: access, error } = await supabaseAdmin
        .from('document_collaborators')
        .select('permission')
        .eq('document_id', documentId)
        .eq('user_id', userId)
        .single();

      if (error || !access) {
        return res.status(403).json({ error: 'Access denied: No document access' });
      }

      // Check permission level
      const permissionHierarchy = { read: 1, write: 2, admin: 3 };
      const userPermissionLevel = permissionHierarchy[access.permission] || 0;
      const requiredPermissionLevel = permissionHierarchy[permission] || 1;

      if (userPermissionLevel < requiredPermissionLevel) {
        return res.status(403).json({ 
          error: `Access denied: Requires ${permission} permission or higher` 
        });
      }

      req.documentPermission = access.permission;
      next();
    } catch (error) {
      console.error('Document access check error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
};

module.exports = {
  authenticateToken,
  requireWorkspaceAccess,
  requireDocumentAccess
};
