import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckSquare,
  Plus,
  Clock,
  User,
  AlertCircle,
  MessageSquare,
  Paperclip,
  Search,
  Filter,
  Eye,
  Edit,
  Trash2,
  Calendar,
  LayoutGrid,
  List,
  CheckCircle2,
  Circle,
  ChevronDown
} from 'lucide-react';
import TaskDetailDrawer from '../components/dashboard/TaskDetailDrawer';
import { getWorkspaceCollection, setWorkspaceCollection, invalidateWorkspaceCache } from '../utils/dashboardCache';

export default function TasksPage() {
  const { user, activeWorkspace } = useAuth();
  const wsId = activeWorkspace?.id;
  const cachedProjs = getWorkspaceCollection(wsId, 'projects');
  const cachedMembers = getWorkspaceCollection(wsId, 'members');

  const [projects, setProjects] = useState(() => cachedProjs?.data || []);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    return cachedProjs?.data?.length > 0 ? cachedProjs.data[0].id.toString() : '';
  });
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState(() => cachedMembers?.data || []);
  const [loading, setLoading] = useState(true);

  // View Mode: 'board' | 'list'
  const [viewMode, setViewMode] = useState('board');

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [dueDateFilter, setDueDateFilter] = useState('all');

  // Drawer & Modal State
  const [selectedTask, setSelectedTask] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { setIsNewTaskModalOpen, setEditingTask, setNewTaskProjectId } = useOutletContext() || {};

  // Deep link: /dashboard/tasks?task=123 opens that task straight away. This
  // is the target of the "a task was assigned to you" notification, so the
  // bell actually takes the user to the work instead of just the board.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkTaskId = searchParams.get('task');

  useEffect(() => {
    if (!deepLinkTaskId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const data = await api.get(`/tasks/${deepLinkTaskId}`);
        if (cancelled || !data.success || !data.task) return;
        if (data.task.project_id) {
          setSelectedProjectId(String(data.task.project_id));
        }
        setSelectedTask(data.task);
        setIsDrawerOpen(true);
      } catch (err) {
        console.warn('Could not open linked task:', err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [deepLinkTaskId]);

  // Dragging state
  const [draggedTaskId, setDraggedTaskId] = useState(null);

  // Permissions
  const canManage = ['super_admin', 'admin', 'member'].includes(user?.role);

  // Fetch Projects and Workspace Members
  useEffect(() => {
    const fetchInitData = async () => {
      if (!wsId) return;
      const cP = getWorkspaceCollection(wsId, 'projects');
      const cM = getWorkspaceCollection(wsId, 'members');

      if (cP?.isFresh && cM?.isFresh) {
        setProjects(cP.data);
        setMembers(cM.data);
        if (cP.data.length > 0 && !selectedProjectId) {
          setSelectedProjectId(cP.data[0].id.toString());
        }
        return;
      }

      try {
        const [projRes, memRes] = await Promise.all([
          api.get(`/projects?workspace_id=${wsId}`),
          api.get(`/workspaces/${wsId}/members`)
        ]);
        const projs = projRes.projects || [];
        const mems = memRes.members || [];
        setProjects(projs);
        setMembers(mems);
        setWorkspaceCollection(wsId, 'projects', projs);
        setWorkspaceCollection(wsId, 'members', mems);
        if (projs.length > 0 && !selectedProjectId) {
          setSelectedProjectId(projs[0].id.toString());
        }
      } catch (err) {
        console.warn('Fetch initial tasks page data error:', err.message);
      }
    };
    fetchInitData();
  }, [wsId]);

  // Fetch Tasks for Selected Project
  const fetchTasks = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await api.get(`/tasks?project_id=${selectedProjectId}`);
      setTasks(data.tasks || []);
    } catch (err) {
      console.warn('Fetch tasks error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Status Change (Kanban Drop or List change)
  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await api.patch(`/tasks/${taskId}/status`, { status: newStatus });
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status: newStatus } : t)));
      invalidateWorkspaceCache(activeWorkspace?.id);
    } catch (err) {
      console.error('Task status update failed:', err.message);
    }
  };

  // Drag & Drop Handlers
  const handleDragStart = (e, taskId) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId.toString());
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e, targetStatus) => {
    e.preventDefault();
    const taskIdStr = e.dataTransfer.getData('text/plain');
    const taskId = parseInt(taskIdStr, 10);
    if (!taskId) return;

    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== targetStatus) {
      await handleStatusChange(taskId, targetStatus);
    }
    setDraggedTaskId(null);
  };

  // Delete Task
  const handleDeleteTask = async (taskId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) {
      console.error('Delete task error:', err.message);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (task, e) => {
    if (e) e.stopPropagation();
    if (setEditingTask) setEditingTask(task);
    if (setNewTaskProjectId) setNewTaskProjectId(task.project_id ? String(task.project_id) : null);
    if (setIsNewTaskModalOpen) setIsNewTaskModalOpen(true);
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    if (setEditingTask) setEditingTask(null);
    if (setNewTaskProjectId) setNewTaskProjectId(selectedProjectId);
    if (setIsNewTaskModalOpen) setIsNewTaskModalOpen(true);
  };

  // Filter Tasks
  const filteredTasks = useMemo(() => {
    const todayStr = new Date().toISOString().substring(0, 10);
    const now = new Date();
    const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

    return tasks.filter(task => {
      // Search
      const matchesSearch =
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));

      // Priority
      const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;

      // Assignee
      const matchesAssignee =
        assigneeFilter === 'all' ||
        (assigneeFilter === 'unassigned' && !task.assignee_id) ||
        (task.assignee_id && task.assignee_id.toString() === assigneeFilter);

      // Due Date
      let matchesDueDate = true;
      if (dueDateFilter === 'overdue') {
        matchesDueDate = Boolean(task.due_date && task.due_date.substring(0, 10) < todayStr && task.status !== 'done');
      } else if (dueDateFilter === 'today') {
        matchesDueDate = Boolean(task.due_date && task.due_date.substring(0, 10) === todayStr);
      } else if (dueDateFilter === 'this_week') {
        matchesDueDate = Boolean(task.due_date && task.due_date.substring(0, 10) >= todayStr && task.due_date.substring(0, 10) <= oneWeekLater);
      } else if (dueDateFilter === 'no_date') {
        matchesDueDate = !task.due_date;
      }

      return matchesSearch && matchesPriority && matchesAssignee && matchesDueDate;
    });
  }, [tasks, searchQuery, priorityFilter, assigneeFilter, dueDateFilter]);

  const columns = [
    { id: 'todo', title: 'To Do', color: 'bg-zinc-500', border: 'border-zinc-500/30' },
    { id: 'in_progress', title: 'In Progress', color: 'bg-amber-500', border: 'border-amber-500/30' },
    { id: 'in_review', title: 'In Review', color: 'bg-sky-500', border: 'border-sky-500/30' },
    { id: 'done', title: 'Completed', color: 'bg-emerald-500', border: 'border-emerald-500/30' }
  ];

  const getPriorityStyle = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'high': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'medium': return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
      default: return 'bg-zinc-800 text-zinc-400 border-white/10';
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Bar: Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-white" />
            Project Tasks
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Organize sprints with drag-and-drop Kanban or a granular tabular List view.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* Project Switcher */}
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="bg-zinc-900 border border-white/15 rounded-xl px-3.5 py-2 text-xs font-semibold text-white focus:outline-none focus:border-white/30 cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Project: {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* View Mode Toggle: Board vs List */}
          <div className="flex items-center bg-zinc-900 border border-white/10 rounded-xl p-0.5">
            <button
              onClick={() => setViewMode('board')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'board'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
              title="Kanban Board View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Board</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
              title="Tabular List View"
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>

          {canManage ? (
            <button
              onClick={handleOpenCreate}
              className="bg-white text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 hover:bg-zinc-200 transition-all cursor-pointer shadow-md"
            >
              <Plus className="w-4 h-4" />
              <span>Add Task</span>
            </button>
          ) : (
            <span className="text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1.5 rounded-xl">
              Read-Only Mode
            </span>
          )}
        </div>
      </div>

      {/* Advanced Filter Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-zinc-950 border border-white/10 p-3.5 rounded-2xl">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks by title or description..."
            className="w-full bg-zinc-900 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
          />
        </div>

        {/* Dropdowns Group */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Priority Filter */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs">
            <span className="text-[11px] text-zinc-500 font-medium">Priority:</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="bg-transparent text-white text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-zinc-900">All</option>
              <option value="urgent" className="bg-zinc-900">Urgent</option>
              <option value="high" className="bg-zinc-900">High</option>
              <option value="medium" className="bg-zinc-900">Medium</option>
              <option value="low" className="bg-zinc-900">Low</option>
            </select>
          </div>

          {/* Assignee Filter */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs">
            <span className="text-[11px] text-zinc-500 font-medium">Assignee:</span>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="bg-transparent text-white text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-zinc-900">All Collaborators</option>
              <option value="unassigned" className="bg-zinc-900">Unassigned</option>
              {members.map(m => (
                <option key={m.id} value={m.id.toString()} className="bg-zinc-900">{m.name}</option>
              ))}
            </select>
          </div>

          {/* Due Date Filter */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs">
            <span className="text-[11px] text-zinc-500 font-medium">Deadline:</span>
            <select
              value={dueDateFilter}
              onChange={(e) => setDueDateFilter(e.target.value)}
              className="bg-transparent text-white text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-zinc-900">All Deadlines</option>
              <option value="overdue" className="bg-zinc-900 text-red-400">Overdue</option>
              <option value="today" className="bg-zinc-900 text-amber-400">Due Today</option>
              <option value="this_week" className="bg-zinc-900 text-indigo-400">Due This Week</option>
              <option value="no_date" className="bg-zinc-900 text-zinc-400">No Deadline</option>
            </select>
          </div>

          {(searchQuery || priorityFilter !== 'all' || assigneeFilter !== 'all' || dueDateFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setPriorityFilter('all');
                setAssigneeFilter('all');
                setDueDateFilter('all');
              }}
              className="text-xs text-zinc-400 hover:text-white px-2 py-1.5 underline cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Content: Kanban Board vs Tabular List */}
      {loading ? (
        <div className="p-16 text-center text-xs text-zinc-500 bg-zinc-950 border border-white/10 rounded-3xl">
          Loading project tasks from database...
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="p-16 text-center bg-zinc-950 border border-dashed border-white/10 rounded-3xl space-y-2">
          <CheckSquare className="w-8 h-8 text-zinc-600 mx-auto" />
          <p className="text-sm font-semibold text-white">No tasks matching filters</p>
          <p className="text-xs text-zinc-500">Try adjusting your search criteria or add a new task.</p>
        </div>
      ) : viewMode === 'board' ? (
        /* ================= KANBAN BOARD VIEW ================= */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {columns.map((col) => {
            const columnTasks = filteredTasks.filter(t => t.status === col.id);

            return (
              <div
                key={col.id}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.id)}
                className="bg-zinc-950/80 border border-white/10 rounded-2xl p-4 flex flex-col min-h-[550px] transition-colors"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                    <h2 className="text-xs font-bold text-white uppercase tracking-wider">{col.title}</h2>
                  </div>
                  <span className="text-[10px] bg-white/10 text-zinc-300 font-bold px-2 py-0.5 rounded-full">
                    {columnTasks.length}
                  </span>
                </div>

                {/* Cards List */}
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {columnTasks.map((task) => (
                    <motion.div
                      key={task.id}
                      draggable={canManage}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onClick={() => {
                        setSelectedTask(task);
                        setIsDrawerOpen(true);
                      }}
                      whileHover={{ y: -3, scale: 1.015 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className={`p-4 bg-zinc-900/60 border border-white/10 rounded-xl space-y-3 cursor-pointer hover:border-white/30 transition-colors shadow-md hover:shadow-xl hover:shadow-black/60 group ${
                        draggedTaskId === task.id ? 'opacity-40' : ''
                      }`}
                    >
                      {/* Priority Tag & Actions */}
                      <div className="flex items-center justify-between">
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${getPriorityStyle(task.priority)}`}>
                          {task.priority}
                        </span>

                        {canManage && (
                          <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => handleOpenEdit(task, e)}
                              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                              title="Edit Task"
                              aria-label={`Edit task: ${task.title}`}
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteTask(task.id, e)}
                              className="p-2 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                              title="Delete Task"
                              aria-label={`Delete task: ${task.title}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Title & Description */}
                      <div>
                        <h3 className="text-xs font-bold text-white line-clamp-2 leading-snug">{task.title}</h3>
                        {task.description && (
                          <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1">{task.description}</p>
                        )}
                      </div>

                      {/* Footer: Assignee, Due Date & Time Tracker Indicator */}
                      <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-400">
                        <div className="flex items-center gap-1.5">
                          {task.assignee_avatar ? (
                            <img src={task.assignee_avatar} alt={task.assignee_name} className="w-5 h-5 rounded-full bg-zinc-800" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center">
                              <User className="w-3 h-3 text-zinc-500" />
                            </div>
                          )}
                          <span className="truncate max-w-[80px]">{task.assignee_name || 'Unassigned'}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {task.actual_hours > 0 && (
                            <span className="text-[10px] text-indigo-400 font-mono">
                              {task.actual_hours}h
                            </span>
                          )}

                          {task.due_date && (
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                              <Calendar className="w-3 h-3" />
                              <span>{new Date(task.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ================= TABULAR LIST VIEW ================= */
        <div className="bg-zinc-950 border border-white/10 rounded-2xl overflow-x-auto shadow-xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 border-b border-white/10 text-zinc-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-3.5">Task Name</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Priority</th>
                <th className="p-3.5">Assignee</th>
                <th className="p-3.5">Deadline</th>
                <th className="p-3.5">Time Logged</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredTasks.map((t) => {
                const todayStr = new Date().toISOString().substring(0, 10);
                const isOverdue = t.due_date && t.due_date.substring(0, 10) < todayStr && t.status !== 'done';

                return (
                  <tr
                    key={t.id}
                    onClick={() => {
                      setSelectedTask(t);
                      setIsDrawerOpen(true);
                    }}
                    className="hover:bg-white/[0.02] cursor-pointer transition-colors group"
                  >
                    <td className="p-3.5">
                      <div className="font-semibold text-white group-hover:text-indigo-400 transition-colors flex items-center gap-2">
                        <span>{t.title}</span>
                        {t.subtask_count > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-zinc-400">
                            {t.completed_subtask_count || 0}/{t.subtask_count}
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5">{t.description}</p>
                      )}
                    </td>

                    <td className="p-3.5">
                      {canManage ? (
                        <select
                          value={t.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleStatusChange(t.id, e.target.value)}
                          className="bg-zinc-900 border border-white/10 text-white rounded-lg px-2 py-1 text-[11px] font-semibold focus:outline-none capitalize cursor-pointer"
                        >
                          <option value="todo">To Do</option>
                          <option value="in_progress">In Progress</option>
                          <option value="in_review">In Review</option>
                          <option value="done">Completed</option>
                        </select>
                      ) : (
                        <span className="capitalize text-zinc-300 font-semibold">{t.status.replace('_', ' ')}</span>
                      )}
                    </td>

                    <td className="p-3.5">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${getPriorityStyle(t.priority)}`}>
                        {t.priority}
                      </span>
                    </td>

                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        {t.assignee_avatar ? (
                          <img src={t.assignee_avatar} alt={t.assignee_name} className="w-5 h-5 rounded-full bg-zinc-800" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center">
                            <User className="w-3 h-3 text-zinc-500" />
                          </div>
                        )}
                        <span className="text-zinc-300 text-xs">{t.assignee_name || 'Unassigned'}</span>
                      </div>
                    </td>

                    <td className="p-3.5">
                      {t.due_date ? (
                        <span className={`text-xs ${isOverdue ? 'text-red-400 font-semibold flex items-center gap-1' : 'text-zinc-400'}`}>
                          {isOverdue && <AlertCircle className="w-3 h-3" />}
                          {new Date(t.due_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      ) : (
                        <span className="text-zinc-600">--</span>
                      )}
                    </td>

                    <td className="p-3.5">
                      <span className="font-mono text-zinc-300">
                        {t.actual_hours || 0}h
                        <span className="text-zinc-400 text-[10px]"> / {t.estimated_hours || 0}h</span>
                      </span>
                    </td>

                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTask(t);
                            setIsDrawerOpen(true);
                          }}
                          className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {canManage && (
                          <>
                            <button
                              onClick={(e) => handleOpenEdit(t, e)}
                              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                              title="Edit Task"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteTask(t.id, e)}
                              className="p-1.5 text-zinc-400 hover:text-red-400 rounded-lg hover:bg-zinc-800 transition-colors"
                              title="Delete Task"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Detail Drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          // Clear the deep link so closing the drawer does not immediately
          // re-open it on the next render.
          if (searchParams.get('task')) {
            searchParams.delete('task');
            setSearchParams(searchParams, { replace: true });
          }
        }}
        onTaskUpdated={fetchTasks}
      />
    </div>
  );
}
