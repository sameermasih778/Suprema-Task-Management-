const pool = require('../config/db');

/**
 * GET /api/v1/projects?workspace_id=1&status=active
 * Fetch projects filtered by workspace and optional status
 */
const getProjects = async (req, res, next) => {
  try {
    const { workspace_id, team_id, status } = req.query;

    if (!workspace_id) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: workspace_id query parameter is required'
      });
    }

    let query = `
      SELECT p.id, p.workspace_id, p.team_id, p.name, p.description, p.status, 
             p.color, p.start_date, p.due_date, p.created_by, p.created_at, p.updated_at,
             u.name AS creator_name,
             t.name AS team_name,
             (SELECT COUNT(*) FROM tasks tk WHERE tk.project_id = p.id) AS total_tasks,
             (SELECT COUNT(*) FROM tasks tk WHERE tk.project_id = p.id AND tk.status = 'done') AS completed_tasks
      FROM projects p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN teams t ON p.team_id = t.id
      WHERE p.workspace_id = $1
    `;

    const queryParams = [workspace_id];

    if (team_id) {
      query += ' AND p.team_id = $' + (queryParams.length + 1);
      queryParams.push(team_id);
    }

    if (status) {
      query += ' AND p.status = $' + (queryParams.length + 1);
      queryParams.push(status);
    }

    query += ' ORDER BY p.created_at DESC';

    const [projects] = await pool.query(query, queryParams);

    res.status(200).json({
      success: true,
      count: projects.length,
      projects
    });

  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/projects
 * Create a new project
 */
const createProject = async (req, res, next) => {
  try {
    const { workspace_id, team_id, name, description, status = 'active', color = '#6366f1', start_date, due_date } = req.body;
    const userId = req.user.id;

    if (!workspace_id || !name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: workspace_id and project name are required'
      });
    }

    const [result] = await pool.query(
      `INSERT INTO projects (workspace_id, team_id, name, description, status, color, start_date, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [workspace_id, team_id || null, name.trim(), description || null, status, color, start_date || null, due_date || null, userId]
    );

    const projectId = result.insertId;

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: {
        id: projectId,
        workspace_id,
        team_id,
        name: name.trim(),
        description,
        status,
        color,
        created_by: userId
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/projects/:id
 * Fetch single project by ID
 */
const getProjectById = async (req, res, next) => {
  try {
    const projectId = req.params.id;

    const [projects] = await pool.query(
      `SELECT p.*, u.name AS creator_name, t.name AS team_name,
              (SELECT COUNT(*) FROM tasks tk WHERE tk.project_id = p.id) AS total_tasks,
              (SELECT COUNT(*) FROM tasks tk WHERE tk.project_id = p.id AND tk.status = 'done') AS completed_tasks
       FROM projects p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN teams t ON p.team_id = t.id
       WHERE p.id = $1`,
      [projectId]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      project: projects[0]
    });

  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/projects/:id
 * Update project details
 */
const updateProject = async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const { name, description, status, color, team_id, due_date } = req.body;

    const [existing] = await pool.query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    await pool.query(
      `UPDATE projects 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           color = COALESCE($4, color),
           team_id = COALESCE($5, team_id),
           due_date = COALESCE($6, due_date)
       WHERE id = $7`,
      [name, description, status, color, team_id, due_date, projectId]
    );

    res.status(200).json({
      success: true,
      message: 'Project updated successfully'
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProjects,
  createProject,
  getProjectById,
  updateProject
};
