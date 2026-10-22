const pool = require('../config/db');
// Headings can carry an escaped "\n" from the admin forms; normalise on read so
// the public card breaks the line instead of printing the escape.
const { withLineBreaks } = require('../utils/text');

/**
 * Blog Admin Controller — editorial CMS for the public /blog page.
 *
 * The public BlogPage reads the `blogs` table via GET /api/v1/blogs.
 * Whatever is written here appears on the marketing site immediately.
 *
 * Roles allowed: super_admin, admin, developer (gated at route layer).
 */

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/* ────────────────────────────────────────────────────────────────────
   GET /api/v1/admin/blogs
   List all blog posts for the admin table (all statuses).
──────────────────────────────────────────────────────────────────── */
const getAdminBlogs = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, slug, category, author_name, author_role,
              status, featured, read_time, published_at, created_at, updated_at
       FROM blogs
       ORDER BY created_at DESC`
    );
    res.json({ success: true, count: rows.length, blogs: rows });
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────────
   GET /api/v1/admin/blogs/:id
   Full blog post for the edit form.
──────────────────────────────────────────────────────────────────── */
const getAdminBlogById = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM blogs WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Blog post not found.' });
    res.json({ success: true, blog: rows[0] });
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────────
   POST /api/v1/admin/blogs
   Create a new blog post.
──────────────────────────────────────────────────────────────────── */
const CATEGORY_STYLES = {
  Efficiency: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  Productivity: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  Collaboration: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  'Task Management': { color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
  Engineering: { color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  Design: { color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20' },
  Company: { color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' }
};

const parseSections = (text) => {
  if (!text) return [];
  const lines = text.split('\n');
  const sections = [];
  let currentHeading = 'Overview';
  let currentContent = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentContent.length) {
        sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
        currentContent = [];
      }
      currentHeading = line.replace(/^##\s+/, '').trim();
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length) {
    sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
  }
  return sections.length ? sections : [{ heading: 'Overview', content: text }];
};

const createBlog = async (req, res, next) => {
  try {
    const {
      title, slug, excerpt, content, category,
      author_name, author_role, author_avatar,
      featured, status, read_time, cover_image, tags
    } = req.body;

    const errors = {};
    if (!clean(title)) errors.title = 'Title is required';
    if (!clean(slug)) errors.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(clean(slug))) errors.slug = 'Slug may only contain lowercase letters, numbers, and hyphens';
    if (!clean(excerpt)) errors.excerpt = 'Excerpt is required';
    if (!clean(content)) errors.content = 'Content is required';
    if (!clean(category)) errors.category = 'Category is required';
    if (!clean(author_name)) errors.author_name = 'Author name is required';

    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, message: 'Please fix the highlighted fields.', errors });
    }

    // Slug uniqueness check
    const [existing] = await pool.query('SELECT id FROM blogs WHERE slug = $1', [clean(slug)]);
    if (existing.length) {
      return res.status(409).json({ success: false, message: 'A post with this slug already exists.', errors: { slug: 'Slug must be unique' } });
    }

    const publishedAt = status === 'published' ? new Date() : null;
    const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : (tags ? JSON.stringify([tags]) : null);
    const sectionsJson = JSON.stringify(parseSections(clean(content)));
    const catStyle = CATEGORY_STYLES[clean(category)] || { color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' };
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const bannerTitle = clean(title).split(' ').slice(0, 4).join('\n');

    const [result] = await pool.query(
      `INSERT INTO blogs
         (title, slug, excerpt, content, sections, category, category_color, category_bg,
          banner_title, date, author_name, author_role, author_avatar, featured,
          status, read_time, cover_image, tags, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [
        clean(title), clean(slug), clean(excerpt), clean(content), sectionsJson,
        clean(category), catStyle.color, catStyle.bg,
        bannerTitle, dateStr, clean(author_name), clean(author_role) || 'Contributor',
        clean(author_avatar) || null, featured ? 1 : 0,
        status || 'draft', clean(read_time) || '5 min read',
        clean(cover_image) || null, tagsJson, publishedAt
      ]
    );

    res.status(201).json({ success: true, message: 'Blog post created.', id: result.insertId });
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────────
   PUT /api/v1/admin/blogs/:id
   Update an existing blog post.
──────────────────────────────────────────────────────────────────── */
const updateBlog = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT id, status, published_at FROM blogs WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Blog post not found.' });

    const {
      title, slug, excerpt, content, category,
      author_name, author_role, author_avatar,
      featured, status, read_time, cover_image, tags
    } = req.body;

    const errors = {};
    if (title !== undefined && !clean(title)) errors.title = 'Title cannot be empty';
    if (slug !== undefined) {
      if (!clean(slug)) errors.slug = 'Slug cannot be empty';
      else if (!/^[a-z0-9-]+$/.test(clean(slug))) errors.slug = 'Slug may only contain lowercase letters, numbers, and hyphens';
      else {
        const [dup] = await pool.query('SELECT id FROM blogs WHERE slug = $1 AND id != $2', [clean(slug), id]);
        if (dup.length) errors.slug = 'Another post already uses this slug';
      }
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors });
    }

    // If status is changing to published for the first time, set published_at
    let publishedAt = existing[0].published_at;
    if (status === 'published' && existing[0].status !== 'published' && !publishedAt) {
      publishedAt = new Date();
    }

    const tagsJson = tags !== undefined
      ? (Array.isArray(tags) ? JSON.stringify(tags) : (tags ? JSON.stringify([tags]) : null))
      : undefined;

    // Build dynamic update
    const fields = [];
    const values = [];
    // PostgreSQL placeholders are numbered ($1, $2, ...) and have to line up
    // with the order of the values array, so the counter advances with every
    // field that is set.
    const set = (col, val) => {
      values.push(val);
      fields.push(`${col} = $` + values.length);
    };

    if (title !== undefined) {
      set('title', clean(title));
      set('banner_title', clean(title).split(' ').slice(0, 4).join('\n'));
    }
    if (slug !== undefined) set('slug', clean(slug));
    if (excerpt !== undefined) set('excerpt', clean(excerpt));
    if (content !== undefined) {
      set('content', clean(content));
      set('sections', JSON.stringify(parseSections(clean(content))));
    }
    if (category !== undefined) {
      set('category', clean(category));
      const style = CATEGORY_STYLES[clean(category)] || { color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' };
      set('category_color', style.color);
      set('category_bg', style.bg);
    }
    if (author_name !== undefined) set('author_name', clean(author_name));
    if (author_role !== undefined) set('author_role', clean(author_role) || null);
    if (author_avatar !== undefined) set('author_avatar', clean(author_avatar) || null);
    if (featured !== undefined) set('featured', featured ? 1 : 0);
    if (status !== undefined) { set('status', status); set('published_at', publishedAt); }
    if (read_time !== undefined) set('read_time', clean(read_time) || null);
    if (cover_image !== undefined) set('cover_image', clean(cover_image) || null);
    if (tagsJson !== undefined) set('tags', tagsJson);

    if (!fields.length) return res.status(400).json({ success: false, message: 'No fields to update.' });

    values.push(id);
    await pool.query(`UPDATE blogs SET ${fields.join(', ')} WHERE id = $` + values.length, values);

    res.json({ success: true, message: 'Blog post updated.' });
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────────
   DELETE /api/v1/admin/blogs/:id
   Permanently remove a blog post.
──────────────────────────────────────────────────────────────────── */
const deleteBlog = async (req, res, next) => {
  try {
    const [result] = await pool.query('DELETE FROM blogs WHERE id = $1', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Blog post not found.' });
    res.json({ success: true, message: 'Blog post deleted.' });
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────────
   GET /api/v1/admin/overview
   Platform-level workspace & project oversight dashboard.
──────────────────────────────────────────────────────────────────── */
const getPlatformOverview = async (req, res, next) => {
  try {
    // Aggregate platform stats
    const [[userStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_users,
         COUNT(*) FILTER (WHERE role = 'super_admin') AS super_admins,
         COUNT(*) FILTER (WHERE role = 'admin') AS admins,
         COUNT(*) FILTER (WHERE role = 'developer') AS developers,
         COUNT(*) FILTER (WHERE role = 'member') AS members,
         COUNT(*) FILTER (WHERE status = 'active') AS active_users,
         COUNT(*) FILTER (WHERE status = 'suspended') AS suspended_users
       FROM users`
    );

    const [[workspaceStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_workspaces,
         COUNT(*) FILTER (WHERE plan = 'free') AS free_plan,
         COUNT(*) FILTER (WHERE plan = 'pro') AS pro_plan,
         COUNT(*) FILTER (WHERE plan = 'enterprise') AS enterprise_plan
       FROM workspaces`
    );

    const [[projectStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_projects,
         COUNT(*) FILTER (WHERE status = 'active') AS active_projects,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_projects,
         COUNT(*) FILTER (WHERE status = 'on_hold') AS on_hold_projects
       FROM projects`
    );

    const [[taskStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_tasks,
         COUNT(*) FILTER (WHERE status = 'todo') AS todo,
         COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
         COUNT(*) FILTER (WHERE status = 'done') AS done
       FROM tasks`
    );

    // Workspaces with member count, project count, owner info
    const [workspaces] = await pool.query(
      `SELECT
         w.id, w.name, w.slug, w.plan, w.created_at,
         u.name AS owner_name, u.email AS owner_email,
         COUNT(DISTINCT wm.user_id) AS member_count,
         COUNT(DISTINCT p.id) AS project_count
       FROM workspaces w
       LEFT JOIN users u ON u.id = w.owner_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
       LEFT JOIN projects p ON p.workspace_id = w.id
       GROUP BY w.id, w.name, w.slug, w.plan, w.created_at, u.name, u.email
       ORDER BY w.created_at DESC
       LIMIT 50`
    );

    // Recent signups (last 10)
    const [recentUsers] = await pool.query(
      `SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 10`
    );

    res.json({
      success: true,
      stats: { users: userStats, workspaces: workspaceStats, projects: projectStats, tasks: taskStats },
      workspaces,
      recentUsers
    });
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────────
   GET /api/v1/blogs
   Public list of published blog posts for marketing site.
──────────────────────────────────────────────────────────────────── */
const getPublicBlogs = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM blogs
       WHERE status = 'published'
       ORDER BY featured DESC, published_at DESC, created_at DESC`
    );

    const blogs = rows.map((b) => {
      let tags = [];
      let sections = [];
      try { tags = typeof b.tags === 'string' ? JSON.parse(b.tags) : (b.tags || []); } catch (_) {}
      try { sections = typeof b.sections === 'string' ? JSON.parse(b.sections) : (b.sections || []); } catch (_) {}

      return {
        ...b,
        tags,
        sections,
        bannerTitle: withLineBreaks(b.banner_title || b.title),
        readTime: b.read_time || '5 min read',
        categoryColor: b.category_color || 'text-emerald-400',
        categoryBg: b.category_bg || 'bg-emerald-500/10 border-emerald-500/20',
        author: {
          name: b.author_name || 'Suprema Team',
          role: b.author_role || 'Contributor',
          handle: b.author_handle || `@${(b.author_name || 'suprema').toLowerCase().replace(/\s+/g, '')}`,
          bio: b.author_bio || '',
          avatar: b.author_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'
        }
      };
    });

    res.json({ success: true, count: blogs.length, blogs });
  } catch (err) {
    next(err);
  }
};

/* ────────────────────────────────────────────────────────────────────
   GET /api/v1/blogs/:slug
   Public detail for a single blog post.
──────────────────────────────────────────────────────────────────── */
const getPublicBlogBySlug = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM blogs WHERE slug = $1 AND status = $2',
      [req.params.slug, 'published']
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Blog post not found.' });
    }

    const b = rows[0];
    let tags = [];
    let sections = [];
    try { tags = typeof b.tags === 'string' ? JSON.parse(b.tags) : (b.tags || []); } catch (_) {}
    try { sections = typeof b.sections === 'string' ? JSON.parse(b.sections) : (b.sections || []); } catch (_) {}

    const blog = {
      ...b,
      tags,
      sections,
      bannerTitle: withLineBreaks(b.banner_title || b.title),
      readTime: b.read_time || '5 min read',
      categoryColor: b.category_color || 'text-emerald-400',
      categoryBg: b.category_bg || 'bg-emerald-500/10 border-emerald-500/20',
      author: {
        name: b.author_name || 'Suprema Team',
        role: b.author_role || 'Contributor',
        handle: b.author_handle || `@${(b.author_name || 'suprema').toLowerCase().replace(/\s+/g, '')}`,
        bio: b.author_bio || '',
        avatar: b.author_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'
      }
    };

    res.json({ success: true, blog });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAdminBlogs,
  getAdminBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
  getPlatformOverview,
  getPublicBlogs,
  getPublicBlogBySlug
};
