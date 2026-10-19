import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Calendar, Clock, User, AlertCircle, Sparkles } from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { invalidateWorkspaceCache } from '../../utils/dashboardCache';

export default function CreateTaskModal({ isOpen, onClose, projectId, onTaskCreated, taskToEdit = null }) {
  const { activeWorkspace } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('todo');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');

  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  // Only used when the modal is opened without a project (header "New Task").
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchWorkspaceMembers();
      fetchProjects();
    }
  }, [activeWorkspace?.id]);

  const fetchProjects = async () => {
    try {
      const data = await api.get(`/projects?workspace_id=${activeWorkspace.id}`);
      setProjects(data.projects || []);
    } catch (err) {
      console.warn('Failed to fetch projects:', err.message);
    }
  };

  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title || '');
      setDescription(taskToEdit.description || '');
      setPriority(taskToEdit.priority || 'medium');
      setStatus(taskToEdit.status || 'todo');
      setAssigneeId(taskToEdit.assignee_id ? taskToEdit.assignee_id.toString() : '');
      setDueDate(taskToEdit.due_date ? taskToEdit.due_date.split('T')[0] : '');
      setEstimatedHours(taskToEdit.estimated_hours ? taskToEdit.estimated_hours.toString() : '');
    } else {
      resetForm();
    }

    // Pre-select the project the modal was opened from. When it was opened from
    // the header button there is no project, so the selector starts empty and
    // the user has to choose one.
    setSelectedProjectId(projectId ? String(projectId) : '');
  }, [taskToEdit, isOpen, projectId]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setStatus('todo');
    setAssigneeId('');
    setDueDate('');
    setEstimatedHours('');
    setError('');
  };

  const fetchWorkspaceMembers = async () => {
    try {
      const data = await api.get(`/workspaces/${activeWorkspace.id}/members`);
      setWorkspaceMembers(data.members || []);
    } catch (err) {
      console.warn('Failed to fetch workspace members:', err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // `projectId` may be null when the modal was opened from the header button,
    // in which case the user picks a project from the selector below.
    const targetProjectId = projectId ?? (selectedProjectId ? parseInt(selectedProjectId, 10) : null);

    if (!title.trim() || !targetProjectId) {
      if (!targetProjectId) setError('Please choose a project for this task.');
      return;
    }

    setSubmitting(true);
    setError('');

    const payload = {
      project_id: targetProjectId,
      title: title.trim(),
      description: description.trim(),
      priority,
      status,
      assignee_id: assigneeId ? parseInt(assigneeId, 10) : null,
      due_date: dueDate || null,
      estimated_hours: estimatedHours ? parseFloat(estimatedHours) : 0
    };

    try {
      if (taskToEdit?.id) {
        await api.put(`/tasks/${taskToEdit.id}`, payload);
      } else {
        await api.post('/tasks', payload);
      }

      invalidateWorkspaceCache(activeWorkspace?.id);
      resetForm();
      onClose();
      if (onTaskCreated) onTaskCreated();
    } catch (err) {
      setError(err.data?.message || err.message || 'Failed to save task.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md overflow-y-auto p-3 sm:p-4 flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 -z-10"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 16 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="relative bg-zinc-950 border border-white/15 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[calc(100vh-2.5rem)] sm:max-h-[88vh] overflow-hidden my-auto backdrop-blur-2xl"
        >
          {/* Header (sticky at top, never cuts off) */}
          <div className="flex items-center justify-between border-b border-white/10 p-5 sm:p-6 bg-zinc-950/95 shrink-0">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {taskToEdit ? 'Edit Task' : 'Create New Task'}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {taskToEdit ? 'Update task details and assignments' : 'Add a task to your project board'}
              </p>
            </div>
            <button
              onClick={onClose}
              type="button"
              className="p-1.5 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-900 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form with scrollable body */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            {/* Shown whenever the modal was opened without a project in context,
                which is the case for the header "New Task" button. */}
            {!projectId && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Project *
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  required
                  className="w-full cursor-pointer rounded-xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-xs text-white focus:outline-none"
                >
                  <option value="" disabled>
                    Select a project…
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                Task Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Build Auth Middleware & JWT Verification"
                className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe acceptance criteria, specs, or details..."
                rows={3}
                className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
              />
            </div>

            {/* Grid 2 Cols: Priority & Status */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="in_review">In Review</option>
                  <option value="done">Completed</option>
                </select>
              </div>
            </div>

            {/* Grid 2 Cols: Assignee & Due Date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                  Assignee
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {workspaceMembers.map((m) => (
                    <option key={m.id} value={m.user_id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none"
                />
              </div>
            </div>

            {/* Estimated Hours */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                Estimated Hours
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="e.g. 4.5"
                className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
              />
            </div>

            </div>

            {/* Actions (sticky at bottom) */}
            <div className="flex items-center justify-end gap-3 p-4 sm:p-6 border-t border-white/10 bg-zinc-950/95 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-white text-black font-semibold text-xs px-5 py-2.5 rounded-xl hover:bg-zinc-200 transition-all disabled:opacity-50 cursor-pointer shadow-md"
              >
                {submitting ? 'Saving...' : taskToEdit ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
