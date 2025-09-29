const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/users/search
// @desc    Search users by email or name
// @access  Private
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const { data: users, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, avatar_url')
      .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(parseInt(limit));

    if (error) {
      return res.status(500).json({ error: 'Failed to search users' });
    }

    res.json({ users });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   GET /api/users/:userId
// @desc    Get user profile by ID
// @access  Private
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, avatar_url, created_at')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   GET /api/users/workspace/:workspaceId/members
// @desc    Get all members of a workspace
// @access  Private
router.get('/workspace/:workspaceId/members', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;

    // Check if user is a member of the workspace
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    // Get all workspace members with their profiles
    const { data: members, error } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        id,
        role,
        joined_at,
        profiles:user_id (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('joined_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch workspace members' });
    }

    // Get online status for each member
    const { data: presence, error: presenceError } = await supabaseAdmin
      .from('user_presence')
      .select('user_id, status, last_seen')
      .eq('workspace_id', workspaceId);

    if (presenceError) {
      console.warn('Failed to fetch user presence:', presenceError);
    }

    // Combine member data with presence
    const membersWithPresence = members.map(member => {
      const userPresence = presence?.find(p => p.user_id === member.profiles.id);
      return {
        id: member.id,
        role: member.role,
        joinedAt: member.joined_at,
        user: {
          ...member.profiles,
          status: userPresence?.status || 'offline',
          lastSeen: userPresence?.last_seen
        }
      };
    });

    res.json({ members: membersWithPresence });
  } catch (error) {
    console.error('Get workspace members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   PUT /api/users/workspace/:workspaceId/members/:memberId/role
// @desc    Update member role in workspace
// @access  Private (Admin/Owner only)
router.put('/workspace/:workspaceId/members/:memberId/role', [
  authenticateToken,
  body('role').isIn(['member', 'admin'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { workspaceId, memberId } = req.params;
    const { role } = req.body;
    const userId = req.user.id;

    // Check if current user is admin or owner
    const { data: currentUserMembership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single();

    if (membershipError || !currentUserMembership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    if (!['admin', 'owner'].includes(currentUserMembership.role)) {
      return res.status(403).json({ error: 'Access denied: Admin or owner role required' });
    }

    // Check if target member exists
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (targetError || !targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Prevent changing owner role
    if (targetMember.role === 'owner') {
      return res.status(403).json({ error: 'Cannot change owner role' });
    }

    // Update member role
    const { data: updatedMember, error: updateError } = await supabaseAdmin
      .from('workspace_members')
      .update({ role })
      .eq('id', memberId)
      .select(`
        id,
        role,
        profiles:user_id (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update member role' });
    }

    res.json({
      message: 'Member role updated successfully',
      member: {
        id: updatedMember.id,
        role: updatedMember.role,
        user: updatedMember.profiles
      }
    });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   DELETE /api/users/workspace/:workspaceId/members/:memberId
// @desc    Remove member from workspace
// @access  Private (Admin/Owner only)
router.delete('/workspace/:workspaceId/members/:memberId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId, memberId } = req.params;
    const userId = req.user.id;

    // Check if current user is admin or owner
    const { data: currentUserMembership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single();

    if (membershipError || !currentUserMembership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    if (!['admin', 'owner'].includes(currentUserMembership.role)) {
      return res.status(403).json({ error: 'Access denied: Admin or owner role required' });
    }

    // Get target member info
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('workspace_members')
      .select('role, profiles:user_id(id, email, full_name)')
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (targetError || !targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Prevent removing owner
    if (targetMember.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove workspace owner' });
    }

    // Remove member from workspace
    const { error: deleteError } = await supabaseAdmin
      .from('workspace_members')
      .delete()
      .eq('id', memberId);

    if (deleteError) {
      return res.status(500).json({ error: 'Failed to remove member' });
    }

    res.json({
      message: 'Member removed successfully',
      removedMember: {
        id: targetMember.profiles.id,
        email: targetMember.profiles.email,
        fullName: targetMember.profiles.full_name
      }
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
