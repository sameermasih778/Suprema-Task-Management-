const express = require('express');
const router = express.Router();
const invitationController = require('../controllers/invitationController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

/**
 * Invitations addressed to the logged-in user, and the endpoint they use to
 * accept or decline one. These are personal - there is no "list everyone's
 * invitations" here, because the controller scopes every read and write to
 * req.user.
 */
router.get('/', invitationController.getMyInvitations);
router.post('/:id/respond', invitationController.respondToInvitation);

module.exports = router;
