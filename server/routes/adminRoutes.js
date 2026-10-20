const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const workspaceAdminController = require('../controllers/workspaceAdminController');
const leadsController = require('../controllers/leadsController');
const changelogAdminController = require('../controllers/changelogAdminController');
const blogAdminController = require('../controllers/blogAdminController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All admin routes require authentication
router.use(authenticateToken);

// --- User Management (Admin, Developer & Super Admin) ---
router.get(
  '/users',
  authorizeRoles('super_admin', 'admin', 'developer'),
  adminController.getAllUsers
);

// Every workspace invitation on the platform, with its status and history.
router.get(
  '/invitations',
  authorizeRoles('super_admin', 'admin', 'developer'),
  adminController.getAllInvitations
);

// --- Workspace management (admin + super admin) ---
// Archive is the reversible path and is the normal one. Permanent delete is
// super admin only, because it destroys every project, task and comment the
// workspace holds.
router.get(
  '/workspaces',
  authorizeRoles('super_admin', 'admin'),
  workspaceAdminController.listWorkspaces
);

router.post(
  '/workspaces',
  authorizeRoles('super_admin', 'admin'),
  workspaceAdminController.createWorkspace
);

router.get(
  '/workspaces/:id/deletion-impact',
  authorizeRoles('super_admin', 'admin'),
  workspaceAdminController.getWorkspaceDeletionImpact
);

router.post(
  '/workspaces/:id/archive',
  authorizeRoles('super_admin', 'admin'),
  workspaceAdminController.archiveWorkspace
);

router.post(
  '/workspaces/:id/restore',
  authorizeRoles('super_admin', 'admin'),
  workspaceAdminController.restoreWorkspace
);

router.delete(
  '/workspaces/:id',
  authorizeRoles('super_admin'),
  workspaceAdminController.deleteWorkspace
);

router.patch(
  '/users/:id/role',
  authorizeRoles('super_admin', 'admin', 'developer'),
  adminController.updateUserRole
);

router.patch(
  '/users/:id/reset-password',
  authorizeRoles('super_admin', 'admin', 'developer'),
  adminController.resetUserPassword
);

// Suspend / Re-activate a user account
router.patch(
  '/users/:id/status',
  authorizeRoles('super_admin', 'admin', 'developer'),
  adminController.updateUserStatus
);

// Delete user - Super Admin only (destructive, irreversible)
router.delete(
  '/users/:id',
  authorizeRoles('super_admin'),
  adminController.deleteUser
);

// --- Changelog Manager (Admin, Developer & Super Admin) ---
// The public /changelogs endpoint already serves these rows; this is the
// editorial side that writes them.
router.get(
  '/changelogs',
  authorizeRoles('super_admin', 'admin', 'developer'),
  changelogAdminController.getAdminChangelogs
);

router.post(
  '/changelogs',
  authorizeRoles('super_admin', 'admin', 'developer'),
  changelogAdminController.createChangelog
);

router.put(
  '/changelogs/:tagId',
  authorizeRoles('super_admin', 'admin', 'developer'),
  changelogAdminController.updateChangelog
);

router.delete(
  '/changelogs/:tagId',
  authorizeRoles('super_admin', 'admin', 'developer'),
  changelogAdminController.deleteChangelog
);

// --- Lead Inbox (Admin, Developer & Super Admin) ---
// Marketing leads captured by the public site. Staff could not read these at
// all before, even though the contact form and waitlist had been saving rows.
router.get(
  '/leads/contact',
  authorizeRoles('super_admin', 'admin', 'developer'),
  leadsController.getContactMessages
);

router.patch(
  '/leads/contact/:id/status',
  authorizeRoles('super_admin', 'admin', 'developer'),
  leadsController.updateContactStatus
);

router.get(
  '/leads/waitlist',
  authorizeRoles('super_admin', 'admin', 'developer'),
  leadsController.getWaitlistLeads
);

router.patch(
  '/leads/waitlist/:id/status',
  authorizeRoles('super_admin', 'admin', 'developer'),
  leadsController.updateWaitlistStatus
);

router.get(
  '/leads/export',
  authorizeRoles('super_admin', 'admin', 'developer'),
  leadsController.exportLeadsCsv
);

// --- Broadcast Notifications (Admin, Developer & Super Admin) ---
router.post(
  '/notifications/broadcast',
  authorizeRoles('super_admin', 'admin', 'developer'),
  adminController.broadcastNotification
);

// --- Platform Overview (Admin, Developer & Super Admin) ---
// Workspace & project oversight + platform-level aggregated stats.
router.get(
  '/overview',
  authorizeRoles('super_admin', 'admin', 'developer'),
  blogAdminController.getPlatformOverview
);

// --- Blog CMS (Admin, Developer & Super Admin) ---
// The public /blog page reads from this same table; publishing here is
// immediately live on the marketing site.
router.get(
  '/blogs',
  authorizeRoles('super_admin', 'admin', 'developer'),
  blogAdminController.getAdminBlogs
);

router.get(
  '/blogs/:id',
  authorizeRoles('super_admin', 'admin', 'developer'),
  blogAdminController.getAdminBlogById
);

router.post(
  '/blogs',
  authorizeRoles('super_admin', 'admin', 'developer'),
  blogAdminController.createBlog
);

router.put(
  '/blogs/:id',
  authorizeRoles('super_admin', 'admin', 'developer'),
  blogAdminController.updateBlog
);

router.delete(
  '/blogs/:id',
  authorizeRoles('super_admin', 'admin'),
  blogAdminController.deleteBlog
);

module.exports = router;
