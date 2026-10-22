const pool = require('../config/db');
const { logActivity } = require('../utils/activityLogger');

/**
 * Tell a user that a task has been assigned to them.
 *
 * The `notifications` table already supports a `task_assigned` type and the
 * header bell polls /notifications every 30s - but nothing was ever writing
 * the row, so an assignment was completely invisible to the assignee. This is
 * the single place that writes it.
 *
 * Deliberately isolated: a failed notification must never fail the task write
 * that triggered it, so this never throws.
 *
 * @param {Object} params
 * @param {number} params.assigneeId  User the task was assigned to
 * @param {number} params.actorId     User who made the assignment
 * @param {string} params.actorName
 * @param {string} params.taskTitle
 * @param {number} params.taskId
 * @param {string} [params.projectName]
 */
const notifyTaskAssigned = async ({ assigneeId, actorId, actorName, taskTitle, taskId, projectName }) => {
  // Never notify someone about work they assigned to themselves.
  if (!assigneeId || Number(assigneeId) === Number(actorId)) return;

  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, link)
       VALUES ($1, $2, $3, 'task_assigned', FALSE, $4) RETURNING id`,
      [
        assigneeId,
        `Task assigned: ${taskTitle}`,
        `${actorName || 'Someone'} assigned you the task "${taskTitle}"${projectName ? ` in project "${projectName}"` : ''}.`,
        `/dashboard/tasks?task=${taskId}`
      ]
    );
  } catch (notifyErr) {
    console.warn('Failed to send task-assigned notification:', notifyErr.message);
  }
};

/**
 * GET /api/v1/tasks?project_id=1&status=todo&assignee_id=3
 * GET /api/v1/tasks?workspace_id=1&status=todo
 * Fetch tasks with optional filters.
 * Scope by either a single project_id, or every project inside a workspace_id.
 */
const getTasks = async (req, res, next) => {
  try {
    const { project_id, workspace_id, status, priority, assignee_id, parent_id } = req.query;

    if (!project_id && !workspace_id) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: either project_id or workspace_id query parameter is required'
      });
    }

    let query = `
      SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
             t.due_date, t.estimated_hours, t.actual_hours, t.created_by, t.assignee_id, t.parent_id,
             t.created_at, t.updated_at,
             u_assignee.name AS assignee_name, u_assignee.avatar_url AS assignee_avatar,
             u_creator.name AS creator_name,
             (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id) AS subtask_count,
             (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id AND sub.status = 'done') AS completed_subtask_count,
             (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
      LEFT JOIN users u_creator ON t.created_by = u_creator.id
    `;

    const queryParams = [];

    if (project_id) {
      query += ' WHERE t.project_id = $1';
      queryParams.push(project_id);
    } else {
      query += ' WHERE p.workspace_id = $1';
      queryParams.push(workspace_id);
    }

    if (status) {
      query += ' AND t.status = $' + (queryParams.length + 1);
      queryParams.push(status);
    }

    if (priority) {
      query += ' AND t.priority = $' + (queryParams.length + 1);
      queryParams.push(priority);
    }

    if (assignee_id) {
      query += ' AND t.assignee_id = $' + (queryParams.length + 1);
      queryParams.push(assignee_id);
    }

    if (parent_id !== undefined) {
      if (parent_id === 'null' || parent_id === '') {
        query += ' AND t.parent_id IS NULL';
      } else {
        query += ' AND t.parent_id = $' + (queryParams.length + 1);
        queryParams.push(parent_id);
      }
    }

    query += ' ORDER BY t.created_at DESC';

    const [tasks] = await pool.query(query, queryParams);

    res.status(200).json({
      success: true,
      count: tasks.length,
      tasks
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/tasks/:id
 * Fetch a single task by ID with metadata
 */
const getTaskById = async (req, res, next) => {
  try {
    const taskId = req.params.id;

    const [tasks] = await pool.query(
      `SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
              t.due_date, t.estimated_hours, t.actual_hours, t.created_by, t.assignee_id, t.parent_id,
              t.created_at, t.updated_at,
              p.name AS project_name, p.workspace_id,
              u_assignee.name AS assignee_name, u_assignee.email AS assignee_email, u_assignee.avatar_url AS assignee_avatar,
              u_creator.name AS creator_name,
              (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id) AS subtask_count,
              (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id AND sub.status = 'done') AS completed_subtask_count,
              (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
       LEFT JOIN users u_creator ON t.created_by = u_creator.id
       WHERE t.id = $1`,
      [taskId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.status(200).json({
      success: true,
      task: tasks[0]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/tasks/:id/activity
 * Per-task change history: who changed this task, what they changed, and when.
 *
 * The rows already exist - every task write goes through logActivity() - they
 * were only ever surfaced in the staff-only workspace Activity Feed. This
 * endpoint scopes them to a single task so the task drawer can show them to
 * everyone who can open the task.
 *
 * Note on `seconds_ago`: the database server's clock does not always agree
 * with the app server's (hosted providers are not reliably NTP-synced), and
 * `created_at` is written by the database. Computing the elapsed time inside
 * the database - against the same clock that produced created_at - keeps
 * "2 minutes ago" correct regardless of any clock drift between the two.
 */
const getTaskActivity = async (req, res, next) => {
  try {
    const taskId = req.params.id;

    const [taskRows] = await pool.query(
      `SELECT t.id, t.title, p.workspace_id
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1`,
      [taskId]
    );

    if (taskRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const workspaceId = taskRows[0].workspace_id;

    // A user may only read the history of a task in a workspace they belong
    // to. Without this check any authenticated user could read another
    // workspace's audit trail by guessing a task id.
    const [membership] = await pool.query(
      'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, req.user.id]
    );

    if (membership.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have access to this task'
      });
    }

    const [activities] = await pool.query(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
              EXTRACT(EPOCH FROM (NOW() - al.created_at))::int AS seconds_ago,
              u.name AS user_name, u.avatar_url AS user_avatar, u.role AS user_role
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.workspace_id = $1 AND al.entity_type = 'task' AND al.entity_id = $2
       ORDER BY al.created_at DESC
       LIMIT 50`,
      [workspaceId, taskId]
    );

    res.status(200).json({
      success: true,
      count: activities.length,
      activities
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/tasks/:id/subtasks
 * Fetch all subtasks for a parent task
 */
const getSubtasks = async (req, res, next) => {
  try {
    const taskId = req.params.id;

    const [subtasks] = await pool.query(
      `SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
              t.due_date, t.estimated_hours, t.parent_id, t.created_at, t.updated_at,
              u_assignee.name AS assignee_name, u_assignee.avatar_url AS assignee_avatar
       FROM tasks t
       LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
       WHERE t.parent_id = $1
       ORDER BY t.created_at ASC`,
      [taskId]
    );

    res.status(200).json({
      success: true,
      count: subtasks.length,
      subtasks
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/tasks
 * Create a new task or subtask
 */
const createTask = async (req, res, next) => {
  try {
    const {
      project_id,
      title,
      description,
      status = 'todo',
      priority = 'medium',
      due_date,
      estimated_hours = 0,
      assignee_id,
      parent_id
    } = req.body;

    const userId = req.user.id;

    if (!project_id || !title || title.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: project_id and task title are required'
      });
    }

    // Get project workspace_id for audit logs
    const [projectRows] = await pool.query('SELECT workspace_id, name FROM projects WHERE id = $1', [project_id]);
    const workspaceId = projectRows.length > 0 ? projectRows[0].workspace_id : null;

    const [result] = await pool.query(
      `INSERT INTO tasks 
       (project_id, title, description, status, priority, due_date, estimated_hours, created_by, assignee_id, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        project_id,
        title.trim(),
        description || null,
        status,
        priority,
        due_date || null,
        estimated_hours,
        userId,
        assignee_id || null,
        parent_id || null
      ]
    );

    const taskId = result.insertId;

    // Log activity
    if (workspaceId) {
      await logActivity({
        workspace_id: workspaceId,
        user_id: userId,
        action: parent_id ? 'SUBTASK_CREATED' : 'TASK_CREATED',
        entity_type: 'task',
        entity_id: taskId,
        details: {
          title: title.trim(),
          project_id,
          parent_id: parent_id || null,
          priority
        }
      });
    }

    // Tell the assignee they have new work waiting for them.
    await notifyTaskAssigned({
      assigneeId: assignee_id,
      actorId: userId,
      actorName: req.user.name,
      taskTitle: title.trim(),
      taskId,
      projectName: projectRows.length > 0 ? projectRows[0].name : null
    });

    res.status(201).json({
      success: true,
      message: parent_id ? 'Subtask created successfully' : 'Task created successfully',
      task: {
        id: taskId,
        project_id,
        title: title.trim(),
        description: description || null,
        status,
        priority,
        due_date: due_date || null,
        estimated_hours,
        created_by: userId,
        assignee_id: assignee_id || null,
        parent_id: parent_id || null
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/tasks/:id
 * Full update for task details (title, description, status, priority, assignee, due_date, etc.)
 */
const updateTask = async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const {
      title,
      description,
      status,
      priority,
      due_date,
      estimated_hours,
      actual_hours,
      assignee_id
    } = req.body;

    const [existing] = await pool.query(
      `SELECT t.*, p.workspace_id, p.name AS project_name
       FROM tasks t 
       JOIN projects p ON t.project_id = p.id 
       WHERE t.id = $1`,
      [taskId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const current = existing[0];

    const updatedTitle = title !== undefined ? title.trim() : current.title;
    const updatedDescription = description !== undefined ? description : current.description;
    const updatedStatus = status !== undefined ? status : current.status;
    const updatedPriority = priority !== undefined ? priority : current.priority;
    const updatedDueDate = due_date !== undefined ? due_date : current.due_date;
    const updatedEstimatedHours = estimated_hours !== undefined ? estimated_hours : current.estimated_hours;
    const updatedActualHours = actual_hours !== undefined ? actual_hours : current.actual_hours;
    const updatedAssigneeId = assignee_id !== undefined ? assignee_id : current.assignee_id;

    // Work out exactly which fields changed, so the change history can say
    // WHAT changed ('priority: medium -> high') instead of a vague
    // 'details were updated'.
    const changes = {};
    const track = (field, from, to) => {
      const norm = (v) => (v === undefined || v === '' ? null : v);
      if (String(norm(from) ?? '') !== String(norm(to) ?? '')) {
        changes[field] = { from: norm(from), to: norm(to) };
      }
    };

    // Resolve assignee ids to names so the history reads 'assigned to Sameer'
    // rather than 'assignee 3 -> 5'.
    const assigneeNames = {};
    const assigneeIds = [current.assignee_id, updatedAssigneeId].filter((v) => v !== undefined && v !== null);
    if (assigneeIds.length) {
      const placeholders = assigneeIds.map((_, i) => '$' + (i + 1)).join(', ');
      const [nameRows] = await pool.query(
        `SELECT id, name FROM users WHERE id IN (${placeholders})`,
        assigneeIds
      );
      nameRows.forEach((u) => { assigneeNames[u.id] = u.name; });
    }

    track('title', current.title, updatedTitle);
    track('description', current.description, updatedDescription);
    track('status', current.status, updatedStatus);
    track('priority', current.priority, updatedPriority);
    track('assignee', assigneeNames[current.assignee_id] || null, assigneeNames[updatedAssigneeId] || null);
    track('due date', current.due_date, updatedDueDate);
    track('estimated hours', current.estimated_hours, updatedEstimatedHours);
    track('actual hours', current.actual_hours, updatedActualHours);

    await pool.query(
      `UPDATE tasks 
       SET title = $1, description = $2, status = $3, priority = $4, due_date = $5, estimated_hours = $6, actual_hours = $7, assignee_id = $8
       WHERE id = $9`,
      [
        updatedTitle,
        updatedDescription,
        updatedStatus,
        updatedPriority,
        updatedDueDate || null,
        updatedEstimatedHours || 0,
        updatedActualHours || 0,
        updatedAssigneeId || null,
        taskId
      ]
    );

    // Audit log
    await logActivity({
      workspace_id: current.workspace_id,
      user_id: req.user.id,
      action: 'TASK_UPDATED',
      entity_type: 'task',
      entity_id: taskId,
      details: {
        title: updatedTitle,
        status: updatedStatus,
        priority: updatedPriority,
        actual_hours: updatedActualHours,
        changes
      }
    });

    // Tell the new assignee they picked up work. Only fires when the assignee
    // actually changed - re-saving the same task must not re-notify.
    const previousAssigneeId = current.assignee_id;
    if (updatedAssigneeId && Number(updatedAssigneeId) !== Number(previousAssigneeId || 0)) {
      await notifyTaskAssigned({
        assigneeId: updatedAssigneeId,
        actorId: req.user.id,
        actorName: req.user.name,
        taskTitle: updatedTitle,
        taskId,
        projectName: current.project_name || null
      });
    }

    res.status(200).json({
      success: true,
      message: 'Task updated successfully',
      task: {
        id: Number(taskId),
        project_id: current.project_id,
        title: updatedTitle,
        description: updatedDescription,
        status: updatedStatus,
        priority: updatedPriority,
        due_date: updatedDueDate,
        estimated_hours: updatedEstimatedHours,
        actual_hours: updatedActualHours,
        assignee_id: updatedAssigneeId
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/tasks/:id/status
 * Kanban status update (drag and drop or checkbox toggle)
 */
const updateTaskStatus = async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const { status } = req.body;

    const validStatuses = ['todo', 'in_progress', 'in_review', 'done'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Validation Error: status must be one of [${validStatuses.join(', ')}]`
      });
    }

    const [existing] = await pool.query(
      `SELECT t.*, p.workspace_id 
       FROM tasks t 
       JOIN projects p ON t.project_id = p.id 
       WHERE t.id = $1`,
      [taskId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const current = existing[0];

    await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [status, taskId]);

    // Audit log
    await logActivity({
      workspace_id: current.workspace_id,
      user_id: req.user.id,
      action: current.parent_id ? 'SUBTASK_STATUS_UPDATED' : 'TASK_STATUS_UPDATED',
      entity_type: 'task',
      entity_id: taskId,
      details: {
        title: current.title,
        old_status: current.status,
        new_status: status
      }
    });

    res.status(200).json({
      success: true,
      message: `Task status updated to '${status}'`
    });

  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/tasks/:id
 * Delete a task or subtask by ID
 */
const deleteTask = async (req, res, next) => {
  try {
    const taskId = req.params.id;

    const [existing] = await pool.query(
      `SELECT t.*, p.workspace_id 
       FROM tasks t 
       JOIN projects p ON t.project_id = p.id 
       WHERE t.id = $1`,
      [taskId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const current = existing[0];

    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);

    // Audit log
    await logActivity({
      workspace_id: current.workspace_id,
      user_id: req.user.id,
      action: current.parent_id ? 'SUBTASK_DELETED' : 'TASK_DELETED',
      entity_type: 'task',
      entity_id: taskId,
      details: { title: current.title }
    });

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully'
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTasks,
  getTaskById,
  getTaskActivity,
  getSubtasks,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask
};
