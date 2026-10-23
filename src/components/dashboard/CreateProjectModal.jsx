import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FolderKanban, Calendar, Users, Palette, Trash2, Sparkles } from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

export default function CreateProjectModal({ isOpen, onClose, onProjectSaved, projectToEdit = null }) {
  const { activeWorkspace } = useAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [color, setColor] = useState('#6366f1');
  const [teamId, setTeamId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [teams, setTeams] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const colorPresets = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6', '#ef4444'];

  // Fetch teams for workspace
  useEffect(() => {
    const fetchTeams = async () => {
      if (activeWorkspace?.id) {
        try {
          const res = await api.get(`/teams?workspace_id=${activeWorkspace.id}`);
          setTeams(res.teams || []);
        } catch (err) {
          console.warn('Teams fetch error:', err.message);
        }
      }
    };
    fetchTeams();
  }, [activeWorkspace?.id]);

  // Populate form if editing
  useEffect(() => {
    if (projectToEdit) {
      setName(projectToEdit.name || '');
      setDescription(projectToEdit.description || '');
      setStatus(projectToEdit.status || 'active');
      setColor(projectToEdit.color || '#6366f1');
      setTeamId(projectToEdit.team_id ? String(projectToEdit.team_id) : '');
      setStartDate(projectToEdit.start_date ? projectToEdit.start_date.split('T')[0] : '');
      setDueDate(projectToEdit.due_date ? projectToEdit.due_date.split('T')[0] : '');
    } else {
      setName('');
      setDescription('');
      setStatus('active');
      setColor('#6366f1');
      setTeamId('');
      setStartDate('');
      setDueDate('');
    }
  }, [projectToEdit, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeWorkspace?.id) {
      setError('No workspace loaded. Please reload the page - a project needs a workspace to belong to.');
      return;
    }
    if (!name || name.trim() === '') {
      setError('Project Name is required.');
      return;
    }

    setError('');
    setSubmitting(true);

    const payload = {
      workspace_id: activeWorkspace.id,
      team_id: teamId ? parseInt(teamId, 10) : null,
      name,
      description,
      status,
      color,
      start_date: startDate || null,
      due_date: dueDate || null
    };

    try {
      if (projectToEdit?.id) {
        await api.put(`/projects/${projectToEdit.id}`, payload);
      } else {
        await api.post('/projects', payload);
      }

      onProjectSaved();
      onClose();
    } catch (err) {
      setError(err.data?.message || err.message || 'Failed to save project. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!projectToEdit?.id || !window.confirm(`Are you sure you want to delete project "${projectToEdit.name}"?`)) return;
    setDeleting(true);
    try {
      await api.delete(`/projects/${projectToEdit.id}`);
      onProjectSaved();
      onClose();
    } catch (err) {
      setError(err.data?.message || err.message || 'Failed to delete project.');
    } finally {
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md overflow-y-auto p-3 sm:p-4 flex items-center justify-center">
        {/* Backdrop click to close */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 -z-10"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="bg-zinc-950 border border-white/15 rounded-3xl w-full max-w-lg shadow-2xl relative flex flex-col max-h-[calc(100vh-2.5rem)] sm:max-h-[88vh] overflow-hidden my-auto"
        >
          {/* Header (sticky at top, never cuts off) */}
          <div className="flex items-center justify-between border-b border-white/10 p-5 sm:p-6 bg-zinc-950/95 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <FolderKanban className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">
                  {projectToEdit ? 'Edit Project' : 'Create New Project'}
                </h2>
                <p className="text-xs text-zinc-400">
                  {projectToEdit ? 'Update project settings & timeline' : `Add project workflow to ${activeWorkspace?.name || 'Workspace'}`}
                </p>
              </div>
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
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-medium">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Website Redesign 2026"
                  className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/60 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Project goals, targets, and scope..."
                  rows={3}
                  className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/60 transition-all resize-none"
                />
              </div>

              {/* Grid: Status & Team */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500/60 transition-all"
                  >
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                    Assigned Team
                  </label>
                  <select
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500/60 transition-all"
                  >
                    <option value="">No Team Assigned</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Color Tag Palette */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider flex items-center justify-between">
                  <span>Color Tag Theme</span>
                  <span className="text-[10px] font-mono text-zinc-500 uppercase">{color}</span>
                </label>
                <div className="flex items-center gap-2 pt-1">
                  {colorPresets.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setColor(preset)}
                      className={`w-7 h-7 rounded-full transition-transform cursor-pointer ${
                        color === preset ? 'ring-2 ring-white scale-110' : 'hover:scale-105 opacity-80'
                      }`}
                      style={{ backgroundColor: preset }}
                    />
                  ))}
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-7 h-7 bg-transparent cursor-pointer rounded-full overflow-hidden border border-white/20 p-0"
                    title="Custom color"
                  />
                </div>
              </div>

              {/* Grid: Dates */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500/60 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                    Target Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500/60 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Footer Buttons (sticky at bottom, always visible) */}
            <div className="flex items-center justify-between p-4 sm:p-6 border-t border-white/10 bg-zinc-950/95 shrink-0">
              {projectToEdit ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{deleting ? 'Deleting...' : 'Delete'}</span>
                </button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-white text-black font-bold text-xs px-5 py-2.5 rounded-xl hover:bg-zinc-200 transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Saving Project...' : (projectToEdit ? 'Update Project' : 'Create Project')}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
