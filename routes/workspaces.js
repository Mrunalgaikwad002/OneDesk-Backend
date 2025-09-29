const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticateToken, requireWorkspaceAccess } = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/workspaces
// @desc    Create a new workspace
// @access  Private
router.post('/', [
  authenticateToken,
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('description').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description } = req.body;
    const userId = req.user.id;

    // Create workspace
    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('workspaces')
      .insert({
        name,
        description,
        owner_id: userId
      })
      .select()
      .single();

    if (workspaceError) {
      return res.status(500).json({ error: 'Failed to create workspace' });
    }

    // Add creator as owner member
    const { error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_id: workspace.id,
        user_id: userId,
        role: 'owner'
      });

    if (memberError) {
      // Clean up workspace if member creation fails
      await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
      return res.status(500).json({ error: 'Failed to add workspace owner' });
    }

    // Create default general chat room
    const { data: chatRoom, error: chatError } = await supabaseAdmin
      .from('chat_rooms')
      .insert({
        workspace_id: workspace.id,
        name: 'General',
        type: 'general',
        created_by: userId
      })
      .select()
      .single();

    if (chatError) {
      console.warn('Failed to create default chat room:', chatError);
    } else {
      // Add creator to general chat room
      await supabaseAdmin
        .from('chat_room_members')
        .insert({
          room_id: chatRoom.id,
          user_id: userId
        });
    }

    res.status(201).json({
      message: 'Workspace created successfully',
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        ownerId: workspace.owner_id,
        createdAt: workspace.created_at
      }
    });
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   GET /api/workspaces
// @desc    Get user's workspaces
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: workspaces, error } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        id,
        role,
        joined_at,
        workspaces:workspace_id (
          id,
          name,
          description,
          owner_id,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', userId)
      .order('joined_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch workspaces' });
    }

    const formattedWorkspaces = workspaces.map(membership => ({
      id: membership.workspaces.id,
      name: membership.workspaces.name,
      description: membership.workspaces.description,
      ownerId: membership.workspaces.owner_id,
      role: membership.role,
      joinedAt: membership.joined_at,
      createdAt: membership.workspaces.created_at,
      updatedAt: membership.workspaces.updated_at
    }));

    res.json({ workspaces: formattedWorkspaces });
  } catch (error) {
    console.error('Get workspaces error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   GET /api/workspaces/:workspaceId
// @desc    Get workspace details
// @access  Private (Workspace member)
router.get('/:workspaceId', [
  authenticateToken,
  requireWorkspaceAccess('member')
], async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const { data: workspace, error } = await supabaseAdmin
      .from('workspaces')
      .select(`
        id,
        name,
        description,
        owner_id,
        created_at,
        updated_at,
        profiles:owner_id (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .eq('id', workspaceId)
      .single();

    if (error || !workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Get member count
    const { count: memberCount, error: countError } = await supabaseAdmin
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if (countError) {
      console.warn('Failed to get member count:', countError);
    }

    res.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        owner: workspace.profiles,
        memberCount: memberCount || 0,
        userRole: req.workspaceRole,
        createdAt: workspace.created_at,
        updatedAt: workspace.updated_at
      }
    });
  } catch (error) {
    console.error('Get workspace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   PUT /api/workspaces/:workspaceId
// @desc    Update workspace
// @access  Private (Admin/Owner only)
router.put('/:workspaceId', [
  authenticateToken,
  requireWorkspaceAccess('admin'),
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('description').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { workspaceId } = req.params;
    const { name, description } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    const { data: workspace, error } = await supabaseAdmin
      .from('workspaces')
      .update(updateData)
      .eq('id', workspaceId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update workspace' });
    }

    res.json({
      message: 'Workspace updated successfully',
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        ownerId: workspace.owner_id,
        updatedAt: workspace.updated_at
      }
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   DELETE /api/workspaces/:workspaceId
// @desc    Delete workspace
// @access  Private (Owner only)
router.delete('/:workspaceId', [
  authenticateToken,
  requireWorkspaceAccess('owner')
], async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // Delete workspace (cascade will handle related records)
    const { error } = await supabaseAdmin
      .from('workspaces')
      .delete()
      .eq('id', workspaceId);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete workspace' });
    }

    res.json({ message: 'Workspace deleted successfully' });
  } catch (error) {
    console.error('Delete workspace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   POST /api/workspaces/:workspaceId/invite
// @desc    Invite user to workspace
// @access  Private (Admin/Owner only)
router.post('/:workspaceId/invite', [
  authenticateToken,
  requireWorkspaceAccess('admin'),
  body('email').isEmail().normalizeEmail(),
  body('role').optional().isIn(['member', 'admin'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { workspaceId } = req.params;
    const { email, role = 'member' } = req.body;

    // Check if user exists
    const { data: user, error: userError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found with this email' });
    }

    // Check if user is already a member
    const { data: existingMember, error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (existingMember) {
      return res.status(400).json({ error: 'User is already a member of this workspace' });
    }

    // Add user to workspace
    const { data: newMember, error: addError } = await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        role
      })
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

    if (addError) {
      return res.status(500).json({ error: 'Failed to add user to workspace' });
    }

    // Add user to general chat room
    const { data: generalRoom, error: roomError } = await supabaseAdmin
      .from('chat_rooms')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('type', 'general')
      .single();

    if (!roomError && generalRoom) {
      await supabaseAdmin
        .from('chat_room_members')
        .insert({
          room_id: generalRoom.id,
          user_id: user.id
        });
    }

    res.status(201).json({
      message: 'User invited to workspace successfully',
      member: {
        id: newMember.id,
        role: newMember.role,
        user: newMember.profiles
      }
    });
  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   POST /api/workspaces/:workspaceId/leave
// @desc    Leave workspace
// @access  Private (Member)
router.post('/:workspaceId/leave', [
  authenticateToken,
  requireWorkspaceAccess('member')
], async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;

    // Check if user is the owner
    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .single();

    if (workspaceError) {
      return res.status(500).json({ error: 'Failed to check workspace ownership' });
    }

    if (workspace.owner_id === userId) {
      return res.status(403).json({ error: 'Workspace owner cannot leave. Transfer ownership or delete workspace instead.' });
    }

    // Remove user from workspace
    const { error: removeError } = await supabaseAdmin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);

    if (removeError) {
      return res.status(500).json({ error: 'Failed to leave workspace' });
    }

    res.json({ message: 'Left workspace successfully' });
  } catch (error) {
    console.error('Leave workspace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
