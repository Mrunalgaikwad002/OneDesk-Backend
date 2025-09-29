const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticateToken, requireWorkspaceAccess, requireDocumentAccess } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/documents/workspace/:workspaceId
// @desc    Get all documents in a workspace
// @access  Private (Workspace member)
router.get('/workspace/:workspaceId', [
  authenticateToken,
  requireWorkspaceAccess('member')
], async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user.id;

    // Get documents where user is a collaborator
    const { data: documents, error } = await supabaseAdmin
      .from('document_collaborators')
      .select(`
        permission,
        joined_at,
        documents:document_id (
          id,
          title,
          created_at,
          updated_at,
          created_by,
          last_modified_by,
          creator:created_by (
            id,
            email,
            full_name,
            avatar_url
          ),
          last_modifier:last_modified_by (
            id,
            email,
            full_name,
            avatar_url
          )
        )
      `)
      .eq('user_id', userId)
      .eq('documents.workspace_id', workspaceId)
      .order('documents.updated_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch documents' });
    }

    const formattedDocuments = documents.map(doc => ({
      id: doc.documents.id,
      title: doc.documents.title,
      permission: doc.permission,
      createdBy: doc.documents.creator,
      lastModifiedBy: doc.documents.last_modifier,
      createdAt: doc.documents.created_at,
      updatedAt: doc.documents.updated_at,
      joinedAt: doc.joined_at
    }));

    res.json({ documents: formattedDocuments });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   POST /api/documents/workspace/:workspaceId
// @desc    Create a new document
// @access  Private (Workspace member)
router.post('/workspace/:workspaceId', [
  authenticateToken,
  requireWorkspaceAccess('member'),
  body('title').trim().isLength({ min: 1, max: 200 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { workspaceId } = req.params;
    const { title } = req.body;
    const userId = req.user.id;

    // Create document
    const { data: document, error: documentError } = await supabaseAdmin
      .from('documents')
      .insert({
        workspace_id: workspaceId,
        title,
        content: null, // Will be populated by Yjs
        created_by: userId,
        last_modified_by: userId
      })
      .select(`
        id,
        title,
        created_at,
        updated_at,
        created_by,
        last_modified_by,
        profiles:created_by (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (documentError) {
      return res.status(500).json({ error: 'Failed to create document' });
    }

    // Add creator as admin collaborator
    const { error: collaboratorError } = await supabaseAdmin
      .from('document_collaborators')
      .insert({
        document_id: document.id,
        user_id: userId,
        permission: 'admin'
      });

    if (collaboratorError) {
      // Clean up document if collaborator creation fails
      await supabaseAdmin.from('documents').delete().eq('id', document.id);
      return res.status(500).json({ error: 'Failed to add document collaborator' });
    }

    res.status(201).json({
      message: 'Document created successfully',
      document: {
        id: document.id,
        title: document.title,
        createdBy: document.profiles,
        createdAt: document.created_at,
        updatedAt: document.updated_at
      }
    });
  } catch (error) {
    console.error('Create document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   GET /api/documents/:documentId
// @desc    Get document details
// @access  Private (Document collaborator)
router.get('/:documentId', [
  authenticateToken,
  requireDocumentAccess('read')
], async (req, res) => {
  try {
    const { documentId } = req.params;

    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .select(`
        id,
        title,
        workspace_id,
        created_at,
        updated_at,
        created_by,
        last_modified_by,
        creator:created_by (
          id,
          email,
          full_name,
          avatar_url
        ),
        last_modifier:last_modified_by (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .eq('id', documentId)
      .single();

    if (error || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Get collaborators
    const { data: collaborators, error: collaboratorsError } = await supabaseAdmin
      .from('document_collaborators')
      .select(`
        permission,
        joined_at,
        profiles:user_id (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .eq('document_id', documentId)
      .order('joined_at', { ascending: true });

    if (collaboratorsError) {
      console.warn('Failed to fetch document collaborators:', collaboratorsError);
    }

    res.json({
      document: {
        id: document.id,
        title: document.title,
        workspaceId: document.workspace_id,
        createdBy: document.creator,
        lastModifiedBy: document.last_modifier,
        collaborators: collaborators?.map(collab => ({
          permission: collab.permission,
          joinedAt: collab.joined_at,
          user: collab.profiles
        })) || [],
        userPermission: req.documentPermission,
        createdAt: document.created_at,
        updatedAt: document.updated_at
      }
    });
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   PUT /api/documents/:documentId
// @desc    Update document title
// @access  Private (Document admin)
router.put('/:documentId', [
  authenticateToken,
  requireDocumentAccess('admin'),
  body('title').trim().isLength({ min: 1, max: 200 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { documentId } = req.params;
    const { title } = req.body;

    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .update({ title })
      .eq('id', documentId)
      .select(`
        id,
        title,
        updated_at
      `)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update document' });
    }

    res.json({
      message: 'Document updated successfully',
      document: {
        id: document.id,
        title: document.title,
        updatedAt: document.updated_at
      }
    });
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   DELETE /api/documents/:documentId
// @desc    Delete document
// @access  Private (Document admin)
router.delete('/:documentId', [
  authenticateToken,
  requireDocumentAccess('admin')
], async (req, res) => {
  try {
    const { documentId } = req.params;

    // Delete document (cascade will handle related records)
    const { error } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete document' });
    }

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   POST /api/documents/:documentId/collaborators
// @desc    Add collaborator to document
// @access  Private (Document admin)
router.post('/:documentId/collaborators', [
  authenticateToken,
  requireDocumentAccess('admin'),
  body('userId').isUUID(),
  body('permission').isIn(['read', 'write'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { documentId } = req.params;
    const { userId, permission } = req.body;

    // Check if user is already a collaborator
    const { data: existingCollaborator, error: existingError } = await supabaseAdmin
      .from('document_collaborators')
      .select('id')
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .single();

    if (existingCollaborator) {
      return res.status(400).json({ error: 'User is already a collaborator' });
    }

    // Verify user is in the same workspace
    const { data: document, error: documentError } = await supabaseAdmin
      .from('documents')
      .select('workspace_id')
      .eq('id', documentId)
      .single();

    if (documentError) {
      return res.status(500).json({ error: 'Failed to verify document workspace' });
    }

    const { data: workspaceMembership, error: workspaceError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', document.workspace_id)
      .eq('user_id', userId)
      .single();

    if (workspaceError || !workspaceMembership) {
      return res.status(400).json({ error: 'User is not a member of this workspace' });
    }

    // Add collaborator
    const { data: collaborator, error: collaboratorError } = await supabaseAdmin
      .from('document_collaborators')
      .insert({
        document_id: documentId,
        user_id: userId,
        permission
      })
      .select(`
        id,
        permission,
        joined_at,
        profiles:user_id (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (collaboratorError) {
      return res.status(500).json({ error: 'Failed to add collaborator' });
    }

    res.status(201).json({
      message: 'Collaborator added successfully',
      collaborator: {
        id: collaborator.id,
        permission: collaborator.permission,
        joinedAt: collaborator.joined_at,
        user: collaborator.profiles
      }
    });
  } catch (error) {
    console.error('Add collaborator error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   PUT /api/documents/:documentId/collaborators/:collaboratorId
// @desc    Update collaborator permission
// @access  Private (Document admin)
router.put('/:documentId/collaborators/:collaboratorId', [
  authenticateToken,
  requireDocumentAccess('admin'),
  body('permission').isIn(['read', 'write'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { documentId, collaboratorId } = req.params;
    const { permission } = req.body;

    const { data: collaborator, error } = await supabaseAdmin
      .from('document_collaborators')
      .update({ permission })
      .eq('id', collaboratorId)
      .eq('document_id', documentId)
      .select(`
        id,
        permission,
        profiles:user_id (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update collaborator permission' });
    }

    res.json({
      message: 'Collaborator permission updated successfully',
      collaborator: {
        id: collaborator.id,
        permission: collaborator.permission,
        user: collaborator.profiles
      }
    });
  } catch (error) {
    console.error('Update collaborator permission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   DELETE /api/documents/:documentId/collaborators/:collaboratorId
// @desc    Remove collaborator from document
// @access  Private (Document admin)
router.delete('/:documentId/collaborators/:collaboratorId', [
  authenticateToken,
  requireDocumentAccess('admin')
], async (req, res) => {
  try {
    const { documentId, collaboratorId } = req.params;

    // Get collaborator info
    const { data: collaborator, error: collaboratorError } = await supabaseAdmin
      .from('document_collaborators')
      .select(`
        id,
        user_id,
        profiles:user_id (
          id,
          email,
          full_name
        )
      `)
      .eq('id', collaboratorId)
      .eq('document_id', documentId)
      .single();

    if (collaboratorError || !collaborator) {
      return res.status(404).json({ error: 'Collaborator not found' });
    }

    // Remove collaborator
    const { error: removeError } = await supabaseAdmin
      .from('document_collaborators')
      .delete()
      .eq('id', collaboratorId);

    if (removeError) {
      return res.status(500).json({ error: 'Failed to remove collaborator' });
    }

    res.json({
      message: 'Collaborator removed successfully',
      removedCollaborator: {
        id: collaborator.profiles.id,
        email: collaborator.profiles.email,
        fullName: collaborator.profiles.full_name
      }
    });
  } catch (error) {
    console.error('Remove collaborator error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   GET /api/documents/:documentId/collaborators
// @desc    Get document collaborators
// @access  Private (Document collaborator)
router.get('/:documentId/collaborators', [
  authenticateToken,
  requireDocumentAccess('read')
], async (req, res) => {
  try {
    const { documentId } = req.params;

    const { data: collaborators, error } = await supabaseAdmin
      .from('document_collaborators')
      .select(`
        id,
        permission,
        joined_at,
        profiles:user_id (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .eq('document_id', documentId)
      .order('joined_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch collaborators' });
    }

    const formattedCollaborators = collaborators.map(collab => ({
      id: collab.id,
      permission: collab.permission,
      joinedAt: collab.joined_at,
      user: collab.profiles
    }));

    res.json({ collaborators: formattedCollaborators });
  } catch (error) {
    console.error('Get collaborators error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
