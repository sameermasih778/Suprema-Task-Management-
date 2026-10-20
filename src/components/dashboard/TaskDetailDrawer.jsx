import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  X,
  CheckCircle2,
  Circle,
  Clock,
  User,
  AlertCircle,
  MessageSquare,
  Paperclip,
  Send,
  Trash2,
  UploadCloud,
  FileText,
  Calendar,
  Layers,
  ChevronDown,
  CheckSquare,
  Plus,
  Edit3,
  Save,
  Check,
  FolderKanban,
  History
} from 'lucide-react';
import api, { assetUrl } from '../../utils/api';
import Avatar from '../Avatar';
import { useAuth } from '../../context/AuthContext';
import { invalidateWorkspaceCache } from '../../utils/dashboardCache';

export default function TaskDetailDrawer({ task, isOpen, onClose, onTaskUpdated: rawOnTaskUpdated }) {
  const { user, activeWorkspace } = useAuth();
  const onTaskUpdated = () => {
    invalidateWorkspaceCache(activeWorkspace?.id);
    if (rawOnTaskUpdated) rawOnTaskUpdated();
  };
  const [activeTab, setActiveTab] = useState('subtasks'); // 'subtasks' | 'comments' | 'attachments' | 'activity'

  // Task Details & Edit State
  const [taskDetails, setTaskDetails] = useState(task);
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [currentStatus, setCurrentStatus] = useState(task?.status || 'todo');
  const [currentPriority, setCurrentPriority] = useState(task?.priority || 'medium');
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id || '');
  const [dueDate, setDueDate] = useState(task?.due_date ? task.due_date.substring(0, 10) : '');
  const [estimatedHours, setEstimatedHours] = useState(task?.estimated_hours || 0);
  const [actualHours, setActualHours] = useState(task?.actual_hours || 0);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Subtasks State
  const [subtasks, setSubtasks] = useState([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Comments State
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  // Attachments State
  const [attachments, setAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Activity (change history) State
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // Workspace Members for Assignee selection
  const [members, setMembers] = useState([]);

  const canManage = ['super_admin', 'admin', 'developer', 'member'].includes(user?.role);

  useEffect(() => {
    if (task?.id && isOpen) {
      setTaskDetails(task);
      setTitle(task.title || '');
      setDescription(task.description || '');
      setCurrentStatus(task.status || 'todo');
      setCurrentPriority(task.priority || 'medium');
      setAssigneeId(task.assignee_id || '');
      setDueDate(task.due_date ? task.due_date.substring(0, 10) : '');
      setEstimatedHours(task.estimated_hours || 0);
      setActualHours(task.actual_hours || 0);

      fetchFreshDetails();
      fetchSubtasks();
      fetchComments();
      fetchAttachments();
      fetchActivity();
      fetchWorkspaceMembers();
    }
  }, [task?.id, isOpen]);

  // Fetch full details
  const fetchFreshDetails = async () => {
    if (!task?.id) return;
    try {
      const data = await api.get(`/tasks/${task.id}`);
      if (data.success && data.task) {
        setTaskDetails(data.task);
        setTitle(data.task.title || '');
        setDescription(data.task.description || '');
        setCurrentStatus(data.task.status || 'todo');
        setCurrentPriority(data.task.priority || 'medium');
        setAssigneeId(data.task.assignee_id || '');
        setDueDate(data.task.due_date ? data.task.due_date.substring(0, 10) : '');
        setEstimatedHours(data.task.estimated_hours || 0);
        setActualHours(data.task.actual_hours || 0);
      }
    } catch (err) {
      console.warn('Failed to fetch fresh task details:', err.message);
    }
  };

  // Fetch Workspace Members
  const fetchWorkspaceMembers = async () => {
    if (!activeWorkspace?.id) return;
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/members`);
      setMembers(res.members || []);
    } catch (err) {
      console.warn('Failed to fetch workspace members:', err.message);
    }
  };

  // Fetch Change History (who changed this task and when)
  const fetchActivity = async () => {
    if (!task?.id) return;
    setLoadingActivity(true);
    try {
      const res = await api.get(`/tasks/${task.id}/activity`);
      setActivity(res.activities || []);
    } catch (err) {
      console.warn('Failed to fetch task activity:', err.message);
    } finally {
      setLoadingActivity(false);
    }
  };

  /**
   * Turn a raw activity_logs row into a human sentence, e.g.
   * "created this task with high priority" or
   * "updated priority (medium -> high)".
   */
  const formatActivityText = (entry) => {
    let details = entry.details;
    if (typeof details === 'string') {
      try { details = JSON.parse(details); } catch { details = {}; }
    }
    details = details || {};

    switch (entry.action) {
      case 'TASK_CREATED':
        return details.priority
          ? `created this task with ${details.priority} priority`
          : 'created this task';
      case 'SUBTASK_CREATED':
        return `added the subtask "${details.title || 'Checklist item'}"`;
      case 'TASK_UPDATED': {
        const changes = details.changes || {};
        const parts = Object.entries(changes).map(([field, value]) => {
          const label = field.replace(/_/g, ' ');
          if (value.from === null || value.from === undefined || value.from === '') {
            return `${label} set to ${value.to}`;
          }
          if (value.to === null || value.to === undefined || value.to === '') {
            return `${label} cleared`;
          }
          return `${label} (${value.from} → ${value.to})`;
        });
        return parts.length ? `updated ${parts.join(', ')}` : 'updated the task details';
      }
      case 'TASK_STATUS_UPDATED':
        return `moved the task to ${String(details.new_status || '').replace(/_/g, ' ').toUpperCase()}`;
      case 'SUBTASK_STATUS_UPDATED':
        return `marked subtask "${details.title || 'subtask'}" as ${String(details.new_status || '').toUpperCase()}`;
      case 'TASK_DELETED':
        return 'deleted this task';
      case 'SUBTASK_DELETED':
        return `removed the subtask "${details.title || 'subtask'}"`;
      default:
        return entry.action.toLowerCase().replace(/_/g, ' ');
    }
  };

  /**
   * "3 hours ago" style stamp.
   *
   * The elapsed time is computed by the database (seconds_ago) rather than
   * from the browser clock: created_at is written by the database, and the
   * database's clock can differ from the app server's. Both sides of the
   * subtraction then come from the same clock, so it is always right.
   */
  const formatElapsed = (secondsAgo) => {
    if (secondsAgo === null || secondsAgo === undefined) return '';
    const abs = Math.abs(secondsAgo);
    const units = [
      ['year', 31536000],
      ['month', 2592000],
      ['week', 604800],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60]
    ];
    for (const [unit, secs] of units) {
      if (abs >= secs) {
        return new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
          .format(-Math.round(secondsAgo / secs), unit);
      }
    }
    return 'just now';
  };

  // Save Task Changes
  const handleSaveTaskDetails = async (overrides = {}) => {
    if (!task?.id) return;
    setSavingTask(true);
    try {
      const payload = {
        title: overrides.title !== undefined ? overrides.title : title,
        description: overrides.description !== undefined ? overrides.description : description,
        status: overrides.status !== undefined ? overrides.status : currentStatus,
        priority: overrides.priority !== undefined ? overrides.priority : currentPriority,
        assignee_id: overrides.assignee_id !== undefined ? overrides.assignee_id : (assigneeId ? Number(assigneeId) : null),
        due_date: overrides.due_date !== undefined ? overrides.due_date : (dueDate || null),
        estimated_hours: overrides.estimated_hours !== undefined ? overrides.estimated_hours : Number(estimatedHours),
        actual_hours: overrides.actual_hours !== undefined ? overrides.actual_hours : Number(actualHours)
      };

      const res = await api.put(`/tasks/${task.id}`, payload);
      if (res.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        if (onTaskUpdated) onTaskUpdated();
      }
    } catch (err) {
      console.error('Error updating task details:', err.message);
    } finally {
      setSavingTask(false);
      setIsEditingTitle(false);
      setIsEditingDesc(false);
    }
  };

  // Quick Time Logging
  const handleLogTime = async (increment) => {
    const updated = Math.max(0, parseFloat((Number(actualHours) + increment).toFixed(2)));
    setActualHours(updated);
    await handleSaveTaskDetails({ actual_hours: updated });
  };

  // Status Change
  const handleStatusChange = async (newStatus) => {
    setCurrentStatus(newStatus);
    try {
      await api.patch(`/tasks/${task.id}/status`, { status: newStatus });
      if (onTaskUpdated) onTaskUpdated();
    } catch (err) {
      console.error('Status change error:', err.message);
    }
  };

  // Priority Change
  const handlePriorityChange = (newPriority) => {
    setCurrentPriority(newPriority);
    handleSaveTaskDetails({ priority: newPriority });
  };

  // Assignee Change
  const handleAssigneeChange = (newAssigneeId) => {
    setAssigneeId(newAssigneeId);
    handleSaveTaskDetails({ assignee_id: newAssigneeId ? Number(newAssigneeId) : null });
  };

  // Due Date Change
  const handleDueDateChange = (newDueDate) => {
    setDueDate(newDueDate);
    handleSaveTaskDetails({ due_date: newDueDate || null });
  };

  // SUBTASKS HANDLERS
  const fetchSubtasks = async () => {
    if (!task?.id) return;
    setLoadingSubtasks(true);
    try {
      const data = await api.get(`/tasks/${task.id}/subtasks`);
      setSubtasks(data.subtasks || []);
    } catch (err) {
      console.warn('Failed to fetch subtasks:', err.message);
    } finally {
      setLoadingSubtasks(false);
    }
  };

  const handleAddSubtask = async (e) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim() || !task?.id) return;
    setAddingSubtask(true);
    try {
      const data = await api.post('/tasks', {
        project_id: task.project_id,
        title: newSubtaskTitle.trim(),
        parent_id: task.id,
        status: 'todo',
        priority: 'medium'
      });
      if (data.success && data.task) {
        setSubtasks(prev => [...prev, data.task]);
        setNewSubtaskTitle('');
        if (onTaskUpdated) onTaskUpdated();
      }
    } catch (err) {
      console.error('Add subtask error:', err.message);
    } finally {
      setAddingSubtask(false);
    }
  };

  const handleToggleSubtask = async (subtaskId, currentSubStatus) => {
    const nextStatus = currentSubStatus === 'done' ? 'todo' : 'done';
    try {
      await api.patch(`/tasks/${subtaskId}/status`, { status: nextStatus });
      setSubtasks(prev =>
        prev.map(st => (st.id === subtaskId ? { ...st, status: nextStatus } : st))
      );
      if (onTaskUpdated) onTaskUpdated();
    } catch (err) {
      console.error('Toggle subtask error:', err.message);
    }
  };

  const handleDeleteSubtask = async (subtaskId) => {
    try {
      await api.delete(`/tasks/${subtaskId}`);
      setSubtasks(prev => prev.filter(st => st.id !== subtaskId));
      if (onTaskUpdated) onTaskUpdated();
    } catch (err) {
      console.error('Delete subtask error:', err.message);
    }
  };

  // COMMENTS HANDLERS
  const fetchComments = async () => {
    if (!task?.id) return;
    setLoadingComments(true);
    try {
      const data = await api.get(`/comments?task_id=${task.id}`);
      setComments(data.comments || []);
    } catch (err) {
      console.warn('Failed to fetch comments:', err.message);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !task?.id) return;
    setSubmittingComment(true);
    try {
      const data = await api.post('/comments', {
        task_id: task.id,
        content: newComment
      });
      if (data.success && data.comment) {
        setComments(prev => [...prev, data.comment]);
        setNewComment('');
      }
    } catch (err) {
      console.error('Add comment error:', err.message);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await api.delete(`/comments/${commentId}`);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err) {
      console.error('Delete comment error:', err.message);
    }
  };

  // ATTACHMENTS HANDLERS
  const fetchAttachments = async () => {
    if (!task?.id) return;
    setLoadingAttachments(true);
    try {
      const data = await api.get(`/attachments?task_id=${task.id}`);
      setAttachments(data.attachments || []);
    } catch (err) {
      console.warn('Failed to fetch attachments:', err.message);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !task?.id) return;

    setUploadingFile(true);
    const formData = new FormData();
    formData.append('task_id', task.id);
    formData.append('file', file);

    try {
      const data = await api.post('/attachments', formData);
      if (data.success && data.attachment) {
        fetchAttachments();
      }
    } catch (err) {
      console.error('File upload error:', err.message);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDeleteAttachment = async (attachmentId) => {
    try {
      await api.delete(`/attachments/${attachmentId}`);
      setAttachments(prev => prev.filter(a => a.id !== attachmentId));
    } catch (err) {
      console.error('Delete attachment error:', err.message);
    }
  };

  if (!isOpen || !task) return null;

  // Progress computation
  const completedSubtasksCount = subtasks.filter(st => st.status === 'done').length;
  const subtasksPercent = subtasks.length > 0 ? Math.round((completedSubtasksCount / subtasks.length) * 100) : 0;

  const getPriorityStyle = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'high': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'medium': return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
      default: return 'bg-zinc-800 text-zinc-400 border-white/10';
    }
  };

  // Portalled into <body>: the dashboard page wrapper animates a `filter`,
  // which makes it the containing block for `position: fixed`. In-tree the
  // drawer would slide in against the page box instead of the viewport.
  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] overflow-hidden bg-black/75 backdrop-blur-sm flex justify-end">
        {/* Backdrop overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0"
        />

        {/* Slide-Over Drawer Content */}
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-2xl bg-zinc-950 border-l border-white/15 h-full flex flex-col z-10 shadow-2xl overflow-hidden"
        >
          {/* Top Sticky Header */}
          <div className="p-6 border-b border-white/10 flex items-start justify-between bg-zinc-950/95 backdrop-blur-md">
            <div className="space-y-3 flex-1 pr-4">
              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Priority Selector */}
                {canManage ? (
                  <select
                    value={currentPriority}
                    onChange={(e) => handlePriorityChange(e.target.value)}
                    className={`text-[11px] font-bold uppercase px-3 py-1 rounded-full border cursor-pointer focus:outline-none ${getPriorityStyle(currentPriority)}`}
                  >
                    <option value="low" className="bg-zinc-900 text-zinc-300">Low Priority</option>
                    <option value="medium" className="bg-zinc-900 text-indigo-400">Medium Priority</option>
                    <option value="high" className="bg-zinc-900 text-amber-400">High Priority</option>
                    <option value="urgent" className="bg-zinc-900 text-red-400">Urgent Priority</option>
                  </select>
                ) : (
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${getPriorityStyle(currentPriority)}`}>
                    {currentPriority} Priority
                  </span>
                )}

                {/* Status Selector */}
                {canManage ? (
                  <select
                    value={currentStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    className="bg-zinc-900 border border-white/15 text-white font-semibold text-xs rounded-full px-3 py-1 focus:outline-none cursor-pointer capitalize"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="in_review">In Review</option>
                    <option value="done">Completed</option>
                  </select>
                ) : (
                  <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-300 border border-white/10 capitalize">
                    {currentStatus.replace('_', ' ')}
                  </span>
                )}

                {saveSuccess && (
                  <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>

              {/* Editable Title */}
              {isEditingTitle && canManage ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTaskDetails();
                      if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    autoFocus
                    className="w-full bg-zinc-900 border border-white/20 rounded-xl px-3 py-1.5 text-lg font-bold text-white focus:outline-none focus:border-white/40"
                  />
                  <button
                    onClick={() => handleSaveTaskDetails()}
                    disabled={savingTask}
                    className="bg-white text-black p-2 rounded-xl hover:bg-zinc-200 transition-colors cursor-pointer"
                    title="Save Title"
                  >
                    <Save className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2 group">
                  <h2
                    onClick={() => canManage && setIsEditingTitle(true)}
                    className="text-xl font-bold text-white tracking-tight leading-snug cursor-pointer group-hover:text-zinc-200"
                    title={canManage ? "Click to edit title" : undefined}
                  >
                    {title}
                  </h2>
                  {canManage && (
                    <button
                      onClick={() => setIsEditingTitle(true)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-white transition-opacity cursor-pointer"
                      title="Edit Title"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-900 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Metadata Fields Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-zinc-900/60 border border-white/10 rounded-2xl">
              
              {/* Assignee Field */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1">
                  <User className="w-3 h-3 text-zinc-400" /> Assignee
                </span>
                {canManage ? (
                  <select
                    value={assigneeId}
                    onChange={(e) => handleAssigneeChange(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="">Unassigned</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs font-semibold text-white truncate">
                    {taskDetails?.assignee_name || 'Unassigned'}
                  </p>
                )}
              </div>

              {/* Due Date Field */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-zinc-400" /> Due Date
                </span>
                {canManage ? (
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none cursor-pointer"
                  />
                ) : (
                  <p className="text-xs font-semibold text-white">
                    {dueDate ? new Date(dueDate).toLocaleDateString() : 'No Deadline'}
                  </p>
                )}
              </div>

              {/* Estimated Hours Field */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3 text-zinc-400" /> Estimated
                </span>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={estimatedHours}
                      onChange={(e) => setEstimatedHours(e.target.value)}
                      onBlur={() => handleSaveTaskDetails({ estimated_hours: Number(estimatedHours) })}
                      className="w-16 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                    />
                    <span className="text-xs text-zinc-400">hrs</span>
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-white">
                    {estimatedHours ? `${estimatedHours} hrs` : 'N/A'}
                  </p>
                )}
              </div>

              {/* Project Info */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1">
                  <FolderKanban className="w-3 h-3 text-zinc-400" /> Project
                </span>
                <p className="text-xs font-semibold text-white truncate">
                  {taskDetails?.project_name || 'Active Project'}
                </p>
              </div>

            </div>

            {/* Task Time Tracker Card */}
            <div className="p-4 bg-zinc-900/40 border border-white/10 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Time Tracker</span>
                </div>
                <div className="flex items-center gap-2">
                  {Number(estimatedHours) > 0 && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      Number(actualHours) > Number(estimatedHours)
                        ? 'bg-red-500/15 border-red-500/30 text-red-400'
                        : Number(actualHours) > 0
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                        : 'bg-zinc-800 border-white/10 text-zinc-400'
                    }`}>
                      {Number(actualHours) > Number(estimatedHours)
                        ? `Over estimate (+${(Number(actualHours) - Number(estimatedHours)).toFixed(1)}h)`
                        : Number(actualHours) > 0
                        ? `${((Number(actualHours) / Number(estimatedHours)) * 100).toFixed(0)}% Logged`
                        : 'Not Started'}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-zinc-300">
                    <strong className="text-white">{Number(actualHours).toFixed(1)}h</strong>
                    <span className="text-zinc-500"> / {Number(estimatedHours) > 0 ? `${Number(estimatedHours)}h est.` : 'No est.'}</span>
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              {Number(estimatedHours) > 0 && (
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      Number(actualHours) > Number(estimatedHours) ? 'bg-red-400' : 'bg-indigo-400'
                    }`}
                    style={{ width: `${Math.min(100, (Number(actualHours) / Number(estimatedHours)) * 100)}%` }}
                  />
                </div>
              )}

              {/* Quick log buttons */}
              {canManage && (
                <div className="flex items-center justify-between pt-1 flex-wrap gap-2 text-xs">
                  <span className="text-[11px] text-zinc-400">Quick Log:</span>
                  <div className="flex items-center gap-1.5">
                    {[0.5, 1, 2].map((hrs) => (
                      <button
                        key={hrs}
                        type="button"
                        onClick={() => handleLogTime(hrs)}
                        className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-white/10 rounded-lg text-[11px] font-semibold text-zinc-300 hover:text-white transition-all cursor-pointer"
                      >
                        +{hrs}h
                      </button>
                    ))}
                    <div className="flex items-center gap-1 ml-1 pl-2 border-l border-white/10">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={actualHours}
                        onChange={(e) => setActualHours(e.target.value)}
                        onBlur={() => handleSaveTaskDetails({ actual_hours: Number(actualHours) })}
                        placeholder="0"
                        className="w-14 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none text-center"
                      />
                      <span className="text-[11px] text-zinc-500">hrs</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Task Description */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Description</h3>
                {canManage && !isEditingDesc && (
                  <button
                    onClick={() => setIsEditingDesc(true)}
                    className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
              </div>

              {isEditingDesc && canManage ? (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Enter detailed task description..."
                    className="w-full bg-zinc-900 border border-white/15 rounded-2xl p-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setIsEditingDesc(false)}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-xl border border-white/10 hover:bg-zinc-900 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSaveTaskDetails()}
                      disabled={savingTask}
                      className="px-4 py-1.5 text-xs font-semibold bg-white text-black rounded-xl hover:bg-zinc-200 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" /> Save Description
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => canManage && setIsEditingDesc(true)}
                  className="p-4 bg-zinc-900/40 border border-white/5 rounded-2xl text-xs text-zinc-300 leading-relaxed whitespace-pre-line cursor-pointer hover:border-white/15 transition-all"
                >
                  {description || 'No detailed description provided. Click to add details.'}
                </div>
              )}
            </div>

            {/* Tabs Selector: Subtasks vs Comments vs Attachments */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-4 border-b border-white/10 pb-2">
                
                {/* Tab: Subtasks */}
                <button
                  onClick={() => setActiveTab('subtasks')}
                  className={`text-xs font-bold flex items-center gap-2 pb-2 -mb-2.5 transition-all cursor-pointer ${
                    activeTab === 'subtasks'
                      ? 'text-white border-b-2 border-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <CheckSquare className="w-4 h-4" />
                  <span>Subtasks ({subtasks.length})</span>
                </button>

                {/* Tab: Discussion */}
                <button
                  onClick={() => setActiveTab('comments')}
                  className={`text-xs font-bold flex items-center gap-2 pb-2 -mb-2.5 transition-all cursor-pointer ${
                    activeTab === 'comments'
                      ? 'text-white border-b-2 border-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Discussion ({comments.length})</span>
                </button>

                {/* Tab: Files */}
                <button
                  onClick={() => setActiveTab('attachments')}
                  className={`text-xs font-bold flex items-center gap-2 pb-2 -mb-2.5 transition-all cursor-pointer ${
                    activeTab === 'attachments'
                      ? 'text-white border-b-2 border-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Paperclip className="w-4 h-4" />
                  <span>Files ({attachments.length})</span>
                </button>

                {/* Tab: History (who changed this task and when) */}
                <button
                  onClick={() => setActiveTab('activity')}
                  className={`text-xs font-bold flex items-center gap-2 pb-2 -mb-2.5 transition-all cursor-pointer ${
                    activeTab === 'activity'
                      ? 'text-white border-b-2 border-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <History className="w-4 h-4" />
                  <span>History ({activity.length})</span>
                </button>
              </div>

              {/* ============================================================== */}
              {/* TAB 1: SUBTASKS CHECKLIST WITH PROGRESS BAR */}
              {/* ============================================================== */}
              {activeTab === 'subtasks' && (
                <div className="space-y-4">
                  
                  {/* Subtask Progress Bar */}
                  {subtasks.length > 0 && (
                    <div className="p-3 bg-zinc-900/60 border border-white/10 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-zinc-300">Checklist Progress</span>
                        <span className="text-zinc-400 font-bold">
                          {completedSubtasksCount} of {subtasks.length} ({subtasksPercent}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${subtasksPercent}%` }}
                          transition={{ duration: 0.4 }}
                          className={`h-full rounded-full ${
                            subtasksPercent === 100 ? 'bg-emerald-400' : 'bg-indigo-400'
                          }`}
                        />
                      </div>
                    </div>
                  )}

                  {/* Add Subtask Input Form */}
                  {canManage && (
                    <form onSubmit={handleAddSubtask} className="flex gap-2">
                      <input
                        type="text"
                        value={newSubtaskTitle}
                        onChange={(e) => setNewSubtaskTitle(e.target.value)}
                        placeholder="Add a new subtask..."
                        className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
                      />
                      <button
                        type="submit"
                        disabled={addingSubtask || !newSubtaskTitle.trim()}
                        className="bg-white text-black font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 hover:bg-zinc-200 transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </form>
                  )}

                  {/* Subtasks List */}
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {loadingSubtasks ? (
                      <p className="text-xs text-zinc-500 text-center py-4">Loading subtasks...</p>
                    ) : subtasks.length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-white/5 rounded-2xl space-y-1">
                        <CheckSquare className="w-6 h-6 text-zinc-600 mx-auto mb-1" />
                        <p className="text-xs text-zinc-400 font-semibold">No subtasks yet</p>
                        <p className="text-[10px] text-zinc-500">Break this task into smaller manageable checklist items.</p>
                      </div>
                    ) : (
                      subtasks.map((st) => {
                        const isDone = st.status === 'done';
                        return (
                          <div
                            key={st.id}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                              isDone
                                ? 'bg-zinc-900/30 border-white/5 text-zinc-500'
                                : 'bg-zinc-900/70 border-white/10 text-white'
                            }`}
                          >
                            <div className="flex items-center gap-3 overflow-hidden flex-1">
                              <button
                                onClick={() => handleToggleSubtask(st.id, st.status)}
                                className="cursor-pointer text-zinc-400 hover:text-white transition-colors"
                              >
                                {isDone ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <Circle className="w-4 h-4 text-zinc-500" />
                                )}
                              </button>
                              <span className={`text-xs font-medium truncate ${isDone ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                                {st.title}
                              </span>
                            </div>

                            {canManage && (
                              <button
                                onClick={() => handleDeleteSubtask(st.id)}
                                className="text-zinc-500 hover:text-red-400 p-1 transition-colors cursor-pointer ml-2"
                                title="Delete subtask"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ============================================================== */}
              {/* TAB 2: COMMENTS THREAD */}
              {/* ============================================================== */}
              {activeTab === 'comments' && (
                <div className="space-y-4">
                  {/* Comments List */}
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {loadingComments ? (
                      <p className="text-xs text-zinc-500 text-center py-4">Loading comments...</p>
                    ) : comments.length === 0 ? (
                      <p className="text-xs text-zinc-500 text-center py-6 border border-dashed border-white/5 rounded-2xl">
                        No comments yet. Start the conversation below!
                      </p>
                    ) : (
                      comments.map((c) => (
                        <div key={c.id} className="p-3.5 bg-zinc-900/60 border border-white/5 rounded-2xl space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Avatar
                                person={{
                                  name: c.user_name,
                                  avatar_url: c.user_avatar,
                                  user_role: c.user_role
                                }}
                                roleKey="user_role"
                                alt={c.user_name}
                                className="w-6 h-6 rounded-full bg-zinc-800 border border-white/10"
                              />
                              <span className="text-xs font-bold text-white">{c.user_name}</span>
                              <span className="text-[10px] text-zinc-500">
                                {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            {(c.user_id === user?.id || ['super_admin', 'admin'].includes(user?.role)) && (
                              <button
                                onClick={() => handleDeleteComment(c.id)}
                                className="text-zinc-500 hover:text-red-400 p-1 transition-colors cursor-pointer"
                                title="Delete comment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <p className="text-xs text-zinc-300 leading-normal pl-8">
                            {c.content}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment Input Form */}
                  <form onSubmit={handleAddComment} className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="submit"
                      disabled={submittingComment || !newComment.trim()}
                      className="bg-white text-black font-semibold text-xs px-4 py-2.5 rounded-xl flex items-center gap-1.5 hover:bg-zinc-200 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Post</span>
                    </button>
                  </form>
                </div>
              )}

              {/* ============================================================== */}
              {/* TAB 3: FILE ATTACHMENTS */}
              {/* ============================================================== */}
              {activeTab === 'attachments' && (
                <div className="space-y-4">
                  {/* File Upload Dropzone */}
                  <label className="border-2 border-dashed border-white/15 hover:border-white/30 bg-zinc-900/40 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all">
                    <UploadCloud className="w-8 h-8 text-zinc-400" />
                    <span className="text-xs font-semibold text-zinc-300">
                      {uploadingFile ? 'Uploading file...' : 'Click to upload attachment (Docs, Images, PDFs)'}
                    </span>
                    <span className="text-[10px] text-zinc-500">Max file size: 10MB</span>
                    <input
                      type="file"
                      disabled={uploadingFile}
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>

                  {/* Attachments List */}
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {loadingAttachments ? (
                      <p className="text-xs text-zinc-500 text-center py-4">Loading files...</p>
                    ) : attachments.length === 0 ? (
                      <p className="text-xs text-zinc-500 text-center py-4">No attachments uploaded yet.</p>
                    ) : (
                      attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center justify-between p-3 bg-zinc-900/60 border border-white/10 rounded-xl text-xs"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                            <div className="overflow-hidden">
                              <a
                                href={assetUrl(att.file_path)}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-white hover:underline truncate block"
                              >
                                {att.original_name}
                              </a>
                              <span className="text-[10px] text-zinc-500">
                                {Math.round(att.file_size / 1024)} KB • Uploaded by {att.uploader_name || 'User'}
                              </span>
                            </div>
                          </div>

                          {(att.user_id === user?.id || ['super_admin', 'admin'].includes(user?.role)) && (
                            <button
                              onClick={() => handleDeleteAttachment(att.id)}
                              className="text-zinc-500 hover:text-red-400 p-1.5 transition-colors cursor-pointer"
                              title="Delete file"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ============================================================== */}
              {/* TAB 4: CHANGE HISTORY - who changed this task and when */}
              {/* ============================================================== */}
              {activeTab === 'activity' && (
                <div className="space-y-3">
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Every change to this task is recorded, with who made it and when.
                  </p>

                  {loadingActivity ? (
                    <p className="text-xs text-zinc-500 text-center py-4">Loading history...</p>
                  ) : activity.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center py-4">No changes recorded yet.</p>
                  ) : (
                    <ol className="relative space-y-4 pl-6">
                      {/* Timeline spine */}
                      <span
                        className="absolute left-[7px] top-2 bottom-2 w-px bg-white/10"
                        aria-hidden="true"
                      />

                      {activity.map((entry) => (
                        <li key={entry.id} className="relative">
                          <span className="absolute -left-6 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-800 ring-4 ring-zinc-950">
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                          </span>

                          <div className="flex items-start gap-2.5">
                            <Avatar
                              person={{
                                name: entry.user_name,
                                avatar_url: entry.user_avatar,
                                user_role: entry.user_role
                              }}
                              roleKey="user_role"
                              alt={entry.user_name || 'User'}
                              className="w-6 h-6 rounded-full bg-zinc-800 flex-shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-zinc-300 leading-relaxed">
                                <span className="font-bold text-white">
                                  {entry.user_name || 'System'}
                                </span>{' '}
                                {formatActivityText(entry)}
                              </p>
                              <p
                                className="text-[10px] text-zinc-500 mt-0.5"
                                title={new Date(entry.created_at).toLocaleString()}
                              >
                                {formatElapsed(entry.seconds_ago)}
                              </p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
