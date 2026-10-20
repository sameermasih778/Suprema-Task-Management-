const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const invitationController = require('../controllers/invitationController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken); // All workspace endpoints require JWT auth

router.get('/', workspaceController.getUserWorkspaces);
router.post('/', workspaceController.createWorkspace);
router.get('/:id/members', workspaceController.getWorkspaceMembers);
router.post('/:id/members', workspaceController.addWorkspaceMember);

// Invitations - a request to join, answered by the invited person.
router.get('/:id/invitations', invitationController.getWorkspaceInvitations);
router.post('/:id/invitations', invitationController.createInvitation);

module.exports = router;
