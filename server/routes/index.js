const express = require('express');
const router = express.Router();

const healthRoutes = require('./healthRoutes');
const authRoutes = require('./authRoutes');
const workspaceRoutes = require('./workspaceRoutes');
const teamRoutes = require('./teamRoutes');
const projectRoutes = require('./projectRoutes');
const taskRoutes = require('./taskRoutes');
const commentRoutes = require('./commentRoutes');
const attachmentRoutes = require('./attachmentRoutes');
const notificationRoutes = require('./notificationRoutes');
const activityRoutes = require('./activityRoutes');
const invitationRoutes = require('./invitationRoutes');
const adminRoutes = require('./adminRoutes');
const marketingRoutes = require('./marketingRoutes');

// Mount Sub-routers
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/teams', teamRoutes);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);
router.use('/comments', commentRoutes);
router.use('/attachments', attachmentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/activity', activityRoutes);
router.use('/invitations', invitationRoutes);
router.use('/admin', adminRoutes);

// --- Public Marketing (no session required) ---
router.use('/', marketingRoutes);

module.exports = router;

