const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticateToken, requireWorkspaceAccess } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/tasks/workspace/:workspaceId/boards
// @desc    Get all task boards in a workspace
// @access  Private (Workspace member)
router.get('/workspace/:workspaceId/boards', [
  authenticateToken,
  requireWorkspaceAccess('member')
], async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const { data: boards, error } = await supabaseAdmin
      .from('task_boards')
      .select(`
        id,
        name,
        description,
        created_at,
        updated_at,
        profiles:created_by (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch task boards' });
    }

    const formattedBoards = boards.map(board => ({
      id: board.id,
      name: board.name,
      description: board.description,
      createdBy: board.profiles,
      createdAt: board.created_at,
      updatedAt: board.updated_at
    }));

    res.json({ boards: formattedBoards });
  } catch (error) {
    console.error('Get task boards error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   POST /api/tasks/workspace/:workspaceId/boards
// @desc    Create a new task board
// @access  Private (Workspace member)
router.post('/workspace/:workspaceId/boards', [
  authenticateToken,
  requireWorkspaceAccess('member'),
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('description').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { workspaceId } = req.params;
    const { name, description } = req.body;
    const userId = req.user.id;

    // Create task board
    const { data: board, error: boardError } = await supabaseAdmin
      .from('task_boards')
      .insert({
        workspace_id: workspaceId,
        name,
        description,
        created_by: userId
      })
      .select(`
        id,
        name,
        description,
        created_at,
        profiles:created_by (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (boardError) {
      return res.status(500).json({ error: 'Failed to create task board' });
    }

    // Create default lists
    const defaultLists = [
      { name: 'To Do', position: 0 },
      { name: 'In Progress', position: 1 },
      { name: 'Done', position: 2 }
    ];

    const { data: lists, error: listsError } = await supabaseAdmin
      .from('task_lists')
      .insert(
        defaultLists.map(list => ({
          board_id: board.id,
          name: list.name,
          position: list.position
        }))
      )
      .select('id, name, position');

    if (listsError) {
      // Clean up board if lists creation fails
      await supabaseAdmin.from('task_boards').delete().eq('id', board.id);
      return res.status(500).json({ error: 'Failed to create default lists' });
    }

    res.status(201).json({
      message: 'Task board created successfully',
      board: {
        id: board.id,
        name: board.name,
        description: board.description,
        createdBy: board.profiles,
        lists: lists,
        createdAt: board.created_at
      }
    });
  } catch (error) {
    console.error('Create task board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   GET /api/tasks/boards/:boardId
// @desc    Get task board with lists and tasks
// @access  Private (Workspace member)
router.get('/boards/:boardId', authenticateToken, async (req, res) => {
  try {
    const { boardId } = req.params;
    const userId = req.user.id;

    // Get board info and verify access
    const { data: board, error: boardError } = await supabaseAdmin
      .from('task_boards')
      .select(`
        id,
        name,
        description,
        workspace_id,
        created_at,
        updated_at,
        profiles:created_by (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .eq('id', boardId)
      .single();

    if (boardError || !board) {
      return res.status(404).json({ error: 'Task board not found' });
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', board.workspace_id)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    // Get lists with tasks
    const { data: lists, error: listsError } = await supabaseAdmin
      .from('task_lists')
      .select(`
        id,
        name,
        position,
        created_at,
        updated_at,
        tasks (
          id,
          title,
          description,
          position,
          due_date,
          completed,
          created_at,
          updated_at,
          assigned_to,
          created_by,
          profiles:assigned_to (
            id,
            email,
            full_name,
            avatar_url
          ),
          creator:created_by (
            id,
            email,
            full_name,
            avatar_url
          )
        )
      `)
      .eq('board_id', boardId)
      .order('position', { ascending: true });

    if (listsError) {
      return res.status(500).json({ error: 'Failed to fetch task lists' });
    }

    // Format the response
    const formattedLists = lists.map(list => ({
      id: list.id,
      name: list.name,
      position: list.position,
      createdAt: list.created_at,
      updatedAt: list.updated_at,
      tasks: list.tasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        position: task.position,
        dueDate: task.due_date,
        completed: task.completed,
        assignedTo: task.profiles,
        createdBy: task.creator,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      })).sort((a, b) => a.position - b.position)
    }));

    res.json({
      board: {
        id: board.id,
        name: board.name,
        description: board.description,
        workspaceId: board.workspace_id,
        createdBy: board.profiles,
        lists: formattedLists,
        createdAt: board.created_at,
        updatedAt: board.updated_at
      }
    });
  } catch (error) {
    console.error('Get task board error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   POST /api/tasks/boards/:boardId/lists
// @desc    Create a new task list
// @access  Private (Workspace member)
router.post('/boards/:boardId/lists', [
  authenticateToken,
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('position').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { boardId } = req.params;
    const { name, position } = req.body;
    const userId = req.user.id;

    // Verify access to the board
    const { data: board, error: boardError } = await supabaseAdmin
      .from('task_boards')
      .select('workspace_id')
      .eq('id', boardId)
      .single();

    if (boardError || !board) {
      return res.status(404).json({ error: 'Task board not found' });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', board.workspace_id)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    // Get max position if not provided
    let listPosition = position;
    if (listPosition === undefined) {
      const { data: maxPosition, error: positionError } = await supabaseAdmin
        .from('task_lists')
        .select('position')
        .eq('board_id', boardId)
        .order('position', { ascending: false })
        .limit(1)
        .single();

      listPosition = maxPosition ? maxPosition.position + 1 : 0;
    }

    // Create task list
    const { data: list, error: listError } = await supabaseAdmin
      .from('task_lists')
      .insert({
        board_id: boardId,
        name,
        position: listPosition
      })
      .select('id, name, position, created_at, updated_at')
      .single();

    if (listError) {
      return res.status(500).json({ error: 'Failed to create task list' });
    }

    res.status(201).json({
      message: 'Task list created successfully',
      list: {
        id: list.id,
        name: list.name,
        position: list.position,
        createdAt: list.created_at,
        updatedAt: list.updated_at
      }
    });
  } catch (error) {
    console.error('Create task list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   POST /api/tasks/lists/:listId/tasks
// @desc    Create a new task
// @access  Private (Workspace member)
router.post('/lists/:listId/tasks', [
  authenticateToken,
  body('title').trim().isLength({ min: 1, max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('assignedTo').optional().isUUID(),
  body('dueDate').optional().isISO8601(),
  body('position').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { listId } = req.params;
    const { title, description, assignedTo, dueDate, position } = req.body;
    const userId = req.user.id;

    // Verify access to the list
    const { data: list, error: listError } = await supabaseAdmin
      .from('task_lists')
      .select(`
        id,
        board_id,
        task_boards:board_id (
          workspace_id
        )
      `)
      .eq('id', listId)
      .single();

    if (listError || !list) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', list.task_boards.workspace_id)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    // Get max position if not provided
    let taskPosition = position;
    if (taskPosition === undefined) {
      const { data: maxPosition, error: positionError } = await supabaseAdmin
        .from('tasks')
        .select('position')
        .eq('list_id', listId)
        .order('position', { ascending: false })
        .limit(1)
        .single();

      taskPosition = maxPosition ? maxPosition.position + 1 : 0;
    }

    // Create task
    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .insert({
        list_id: listId,
        title,
        description,
        assigned_to: assignedTo,
        due_date: dueDate,
        position: taskPosition,
        created_by: userId
      })
      .select(`
        id,
        title,
        description,
        position,
        due_date,
        completed,
        created_at,
        updated_at,
        assigned_to,
        created_by,
        profiles:assigned_to (
          id,
          email,
          full_name,
          avatar_url
        ),
        creator:created_by (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (taskError) {
      return res.status(500).json({ error: 'Failed to create task' });
    }

    res.status(201).json({
      message: 'Task created successfully',
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        position: task.position,
        dueDate: task.due_date,
        completed: task.completed,
        assignedTo: task.profiles,
        createdBy: task.creator,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      }
    });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   PUT /api/tasks/tasks/:taskId
// @desc    Update a task
// @access  Private (Workspace member)
router.put('/tasks/:taskId', [
  authenticateToken,
  body('title').optional().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('assignedTo').optional().isUUID(),
  body('dueDate').optional().isISO8601(),
  body('completed').optional().isBoolean(),
  body('position').optional().isInt({ min: 0 }),
  body('listId').optional().isUUID()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { taskId } = req.params;
    const updates = req.body;
    const userId = req.user.id;

    // Verify access to the task
    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select(`
        id,
        list_id,
        task_lists:list_id (
          board_id,
          task_boards:board_id (
            workspace_id
          )
        )
      `)
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', task.task_lists.task_boards.workspace_id)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    // Prepare update data
    const updateData = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.assignedTo !== undefined) updateData.assigned_to = updates.assignedTo;
    if (updates.dueDate !== undefined) updateData.due_date = updates.dueDate;
    if (updates.completed !== undefined) updateData.completed = updates.completed;
    if (updates.position !== undefined) updateData.position = updates.position;
    if (updates.listId !== undefined) updateData.list_id = updates.listId;

    // Update task
    const { data: updatedTask, error: updateError } = await supabaseAdmin
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select(`
        id,
        title,
        description,
        position,
        due_date,
        completed,
        created_at,
        updated_at,
        assigned_to,
        created_by,
        profiles:assigned_to (
          id,
          email,
          full_name,
          avatar_url
        ),
        creator:created_by (
          id,
          email,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update task' });
    }

    res.json({
      message: 'Task updated successfully',
      task: {
        id: updatedTask.id,
        title: updatedTask.title,
        description: updatedTask.description,
        position: updatedTask.position,
        dueDate: updatedTask.due_date,
        completed: updatedTask.completed,
        assignedTo: updatedTask.profiles,
        createdBy: updatedTask.creator,
        createdAt: updatedTask.created_at,
        updatedAt: updatedTask.updated_at
      }
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   DELETE /api/tasks/tasks/:taskId
// @desc    Delete a task
// @access  Private (Workspace member)
router.delete('/tasks/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    // Verify access to the task
    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select(`
        id,
        list_id,
        task_lists:list_id (
          board_id,
          task_boards:board_id (
            workspace_id
          )
        )
      `)
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', task.task_lists.task_boards.workspace_id)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    // Delete task
    const { error: deleteError } = await supabaseAdmin
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (deleteError) {
      return res.status(500).json({ error: 'Failed to delete task' });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// @route   PUT /api/tasks/lists/:listId/reorder
// @desc    Reorder tasks in a list
// @access  Private (Workspace member)
router.put('/lists/:listId/reorder', [
  authenticateToken,
  body('taskIds').isArray().isLength({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { listId } = req.params;
    const { taskIds } = req.body;
    const userId = req.user.id;

    // Verify access to the list
    const { data: list, error: listError } = await supabaseAdmin
      .from('task_lists')
      .select(`
        id,
        board_id,
        task_boards:board_id (
          workspace_id
        )
      `)
      .eq('id', listId)
      .single();

    if (listError || !list) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', list.task_boards.workspace_id)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Access denied: Not a workspace member' });
    }

    // Update task positions
    const updates = taskIds.map((taskId, index) => ({
      id: taskId,
      position: index
    }));

    for (const update of updates) {
      await supabaseAdmin
        .from('tasks')
        .update({ position: update.position })
        .eq('id', update.id)
        .eq('list_id', listId);
    }

    res.json({ message: 'Tasks reordered successfully' });
  } catch (error) {
    console.error('Reorder tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
