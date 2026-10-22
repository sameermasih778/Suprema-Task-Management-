-- ====================================================================
-- Suprema Task Management System - Initial Seed Data (PostgreSQL)
-- Default Login Credentials:
-- Admin: admin@suprema.io / Password123!
-- Developer: developer@suprema.io / Password123!
-- Client: client@suprema.io / Password123!
--
-- Converted from the MySQL seed:
--   ON DUPLICATE KEY UPDATE x=VALUES(x) -> ON CONFLICT (id) DO UPDATE SET x=EXCLUDED.x
--   CURDATE()                         -> CURRENT_DATE
--   DATE_ADD(CURDATE(), INTERVAL n DAY)-> CURRENT_DATE + INTERVAL 'n days'
--   DATE_ADD(NOW(), INTERVAL n DAY)    -> NOW() + INTERVAL 'n days'
-- ====================================================================

-- 1. SEED USERS (Password for all: Password123!)
-- Hash generated via bcrypt (cost factor 10): $2a$10$hknYRN3WqeKeVD.iuX/Xxu4b1PHWwySu/W2OwSGuxRyRrrH4qVpde
INSERT INTO users (id, name, email, password_hash, avatar_url, role, status) VALUES
(1, 'Super Admin', 'admin@suprema.io', '$2a$10$hknYRN3WqeKeVD.iuX/Xxu4b1PHWwySu/W2OwSGuxRyRrrH4qVpde', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin', 'super_admin', 'active'),
(2, 'Sarah Jenkins', 'sarah@suprema.io', '$2a$10$hknYRN3WqeKeVD.iuX/Xxu4b1PHWwySu/W2OwSGuxRyRrrH4qVpde', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah', 'admin', 'active'),
(3, 'Sameer Khokhar', 'developer@suprema.io', '$2a$10$hknYRN3WqeKeVD.iuX/Xxu4b1PHWwySu/W2OwSGuxRyRrrH4qVpde', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sameer', 'developer', 'active'),
(4, 'Alex Rivera', 'alex@suprema.io', '$2a$10$hknYRN3WqeKeVD.iuX/Xxu4b1PHWwySu/W2OwSGuxRyRrrH4qVpde', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex', 'member', 'active'),
(5, 'Client User', 'client@suprema.io', '$2a$10$hknYRN3WqeKeVD.iuX/Xxu4b1PHWwySu/W2OwSGuxRyRrrH4qVpde', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Client', 'viewer', 'active')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- 2. SEED WORKSPACES
INSERT INTO workspaces (id, name, slug, owner_id, plan) VALUES
(1, 'KhawajaLabs HQ', 'khawaja-labs-hq', 1, 'enterprise'),
(2, 'Suprema Product Workspace', 'suprema-product', 2, 'pro')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- 3. SEED WORKSPACE MEMBERS
INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES
(1, 1, 1, 'owner'),
(2, 1, 2, 'admin'),
(3, 1, 3, 'member'),
(4, 1, 4, 'member'),
(5, 1, 5, 'guest'),
(6, 2, 2, 'owner'),
(7, 2, 3, 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- 4. SEED TEAMS
INSERT INTO teams (id, workspace_id, name, description) VALUES
(1, 1, 'Core Engineering', 'Frontend & Backend Software Engineers building Suprema SaaS'),
(2, 1, 'Design & Product', 'UI/UX Designers & Product Strategists'),
(3, 1, 'QA & DevOps', 'Quality Assurance and Infrastructure Automation')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- 5. SEED TEAM MEMBERS
INSERT INTO team_members (id, team_id, user_id, role) VALUES
(1, 1, 3, 'leader'),
(2, 1, 4, 'member'),
(3, 2, 2, 'leader'),
(4, 3, 1, 'leader')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- 6. SEED PROJECTS
INSERT INTO projects (id, workspace_id, team_id, name, description, status, color, start_date, due_date, created_by) VALUES
(1, 1, 1, 'Suprema Full-Stack MVP', 'Production ready Task & Workflow Management SaaS application', 'active', '#6366f1', CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', 1),
(2, 1, 2, 'Design System 2.0', 'Figma components and dark mode aesthetic guidelines', 'planning', '#ec4899', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 2),
(3, 1, 3, 'CI/CD Pipeline & MySQL Setup', 'Automated testing and production MySQL database deployment', 'active', '#10b981', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 days', 1)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- 7. SEED TASKS
INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, estimated_hours, actual_hours, created_by, assignee_id, parent_id) VALUES
(1, 1, 'Setup Repository & Express Server', 'Initialize monorepo layout, middleware, and health check API', 'done', 'high', NOW(), 4.00, 3.50, 1, 3, NULL),
(2, 1, 'Finalize MySQL Schema & Migrations', 'Create relational schema for users, workspaces, teams, projects, and tasks', 'in_progress', 'urgent', NOW() + INTERVAL '1 day', 6.00, 2.00, 1, 3, NULL),
(3, 1, 'Implement Auth & JWT RBAC System', 'Build register, login, refresh token, and authorization middleware', 'todo', 'urgent', NOW() + INTERVAL '3 days', 8.00, 0.00, 1, 3, NULL),
(4, 1, 'Subtask: Write MySQL Foreign Keys', 'Define CASCADE and SET NULL foreign key constraints', 'done', 'medium', NOW(), 2.00, 1.50, 1, 3, 2),
(5, 1, 'Build Kanban & List View UI', 'Interactive drag-and-drop task boards with filters', 'todo', 'high', NOW() + INTERVAL '6 days', 12.00, 0.00, 2, 4, NULL)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;

-- 8. SEED TASK COMMENTS
INSERT INTO task_comments (id, task_id, user_id, content) VALUES
(1, 1, 1, 'Repository setup looks clean! Express server is listening on port 5000.'),
(2, 2, 3, 'MySQL schema is structured into 11 relational tables. Running migrations now.')
ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content;

-- 9. SEED ACTIVITY LOGS
INSERT INTO activity_logs (id, workspace_id, user_id, action, entity_type, entity_id, details) VALUES
(1, 1, 1, 'PROJECT_CREATED', 'project', 1, '{"name": "Suprema Full-Stack MVP"}'),
(2, 1, 3, 'TASK_UPDATED', 'task', 1, '{"status": "done"}')
ON CONFLICT (id) DO UPDATE SET action = EXCLUDED.action;

-- 10. SEED NOTIFICATIONS
INSERT INTO notifications (id, user_id, title, message, type, is_read, link) VALUES
(1, 3, 'Task Assigned', 'You have been assigned to task "Finalize MySQL Schema & Migrations"', 'task_assigned', FALSE, '/tasks/2'),
(2, 3, 'Welcome to Suprema!', 'Your workspace "KhawajaLabs HQ" is ready for production.', 'system', TRUE, '/dashboard')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;
