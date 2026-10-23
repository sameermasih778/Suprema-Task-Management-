import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Users,
  FolderKanban,
  CheckSquare,
  RefreshCw,
  Zap,
  ArrowUpRight,
  ShieldCheck
} from 'lucide-react';
import { motion } from 'framer-motion';
import { getWorkspaceCollection, setWorkspaceCollection } from '../utils/dashboardCache';

export default function AnalyticsPage() {
  const { activeWorkspace, user } = useAuth();
  const wsId = activeWorkspace?.id;
  // The "Collaborator Workload & Time Allocation" table shows every member's
  // task counts and logged hours. A member who was invited to this workspace
  // (and is not its owner/admin) must not see other collaborators' workload
  // - only the owner/admin of the workspace, or staff, see that section.
  const canViewCollaboratorWorkload =
    ['super_admin', 'admin', 'developer'].includes(user?.role) ||
    ['owner', 'admin'].includes(activeWorkspace?.role);

  const cachedProjs = getWorkspaceCollection(wsId, 'projects');
  const cachedTasks = getWorkspaceCollection(wsId, 'tasks');
  const cachedMembers = getWorkspaceCollection(wsId, 'members');

  const [projects, setProjects] = useState(() => cachedProjs?.data || []);
  const [tasks, setTasks] = useState(() => cachedTasks?.data || []);
  const [members, setMembers] = useState(() => cachedMembers?.data || []);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [loading, setLoading] = useState(() => !cachedProjs?.data && !cachedTasks?.data);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (force = false) => {
    if (!wsId) return;
    const cProjs = getWorkspaceCollection(wsId, 'projects');
    const cTasks = getWorkspaceCollection(wsId, 'tasks');
    const cMembers = getWorkspaceCollection(wsId, 'members');

    if (cProjs?.isFresh && cTasks?.isFresh && cMembers?.isFresh && !force) {
      setProjects(cProjs.data);
      setTasks(cTasks.data);
      setMembers(cMembers.data);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!cProjs?.data && !cTasks?.data) {
      setLoading(true);
    }

    try {
      const [projRes, taskRes, memRes] = await Promise.all([
        api.get(`/projects?workspace_id=${wsId}`),
        api.get(`/tasks?workspace_id=${wsId}`),
        api.get(`/workspaces/${wsId}/members`)
      ]);
      const pList = projRes.projects || [];
      const tList = taskRes.tasks || [];
      const mList = memRes.members || [];
      setProjects(pList);
      setTasks(tList);
      setMembers(mList);
      setWorkspaceCollection(wsId, 'projects', pList);
      setWorkspaceCollection(wsId, 'tasks', tList);
      setWorkspaceCollection(wsId, 'members', mList);
    } catch (err) {
      console.warn('Failed to load analytics data:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [wsId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData(true);
  };

  // Filter tasks based on selected project
  const filteredTasks = useMemo(() => {
    if (selectedProjectId === 'all') return tasks;
    return tasks.filter(t => t.project_id.toString() === selectedProjectId);
  }, [tasks, selectedProjectId]);

  // Analytics Computations
  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter(t => t.status === 'done').length;
    const inProgress = filteredTasks.filter(t => t.status === 'in_progress').length;
    const inReview = filteredTasks.filter(t => t.status === 'in_review').length;
    const todo = filteredTasks.filter(t => t.status === 'todo').length;

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const todayStr = new Date().toISOString().substring(0, 10);
    const overdue = filteredTasks.filter(t => t.due_date && t.due_date.substring(0, 10) < todayStr && t.status !== 'done').length;

    const totalEst = filteredTasks.reduce((acc, t) => acc + Number(t.estimated_hours || 0), 0);
    const totalActual = filteredTasks.reduce((acc, t) => acc + Number(t.actual_hours || 0), 0);

    // Priorities
    const urgent = filteredTasks.filter(t => t.priority === 'urgent').length;
    const high = filteredTasks.filter(t => t.priority === 'high').length;
    const medium = filteredTasks.filter(t => t.priority === 'medium').length;
    const low = filteredTasks.filter(t => t.priority === 'low').length;

    return {
      total,
      completed,
      inProgress,
      inReview,
      todo,
      completionRate,
      overdue,
      totalEst,
      totalActual,
      urgent,
      high,
      medium,
      low
    };
  }, [filteredTasks]);

  // Workload by Collaborator
  const memberWorkload = useMemo(() => {
    return members.map(m => {
      const assigned = filteredTasks.filter(t => t.assignee_id === m.id);
      const done = assigned.filter(t => t.status === 'done').length;
      const hoursLogged = assigned.reduce((acc, t) => acc + Number(t.actual_hours || 0), 0);
      return {
        ...m,
        assignedCount: assigned.length,
        doneCount: done,
        hoursLogged: hoursLogged.toFixed(1)
      };
    }).sort((a, b) => b.assignedCount - a.assignedCount);
  }, [members, filteredTasks]);

  return (
    <div className="space-y-8 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-400" />
            Workspace Analytics & Velocity
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time delivery velocity, member workloads, and time tracking metrics for{' '}
            <span className="text-white font-semibold">{activeWorkspace?.name || 'Workspace'}</span>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Project Filter */}
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs">
            <FolderKanban className="w-3.5 h-3.5 text-zinc-400" />
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="bg-transparent text-white text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-zinc-900">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id.toString()} className="bg-zinc-900">{p.name}</option>
              ))}
            </select>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${refreshing ? 'animate-spin text-white' : ''}`} />
            <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
          </motion.button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Completion Velocity */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ y: -4, scale: 1.015, borderColor: 'rgba(255, 255, 255, 0.22)' }}
          className="bg-zinc-950 border border-white/10 p-5 rounded-2xl relative overflow-hidden shadow-lg transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold">Completion Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{stats.completionRate}%</p>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${stats.completionRate}%` }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="h-full bg-emerald-400 rounded-full"
            />
          </div>
          <p className="text-[10px] text-zinc-500 mt-2">{stats.completed} of {stats.total} tasks completed</p>
        </motion.div>

        {/* Card 2: Time Logged */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ y: -4, scale: 1.015, borderColor: 'rgba(255, 255, 255, 0.22)' }}
          className="bg-zinc-950 border border-white/10 p-5 rounded-2xl relative overflow-hidden shadow-lg transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold">Hours Logged</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{stats.totalActual.toFixed(1)}h</p>
          <p className="text-[11px] text-zinc-500 mt-2">
            Estimated budget: <strong className="text-zinc-300">{stats.totalEst.toFixed(1)}h</strong>
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 mt-1">
            <Zap className="w-3 h-3" />
            <span>{stats.totalEst > 0 ? `${((stats.totalActual / stats.totalEst) * 100).toFixed(0)}% budget consumed` : 'No budget set'}</span>
          </div>
        </motion.div>

        {/* Card 3: Active Pipeline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ y: -4, scale: 1.015, borderColor: 'rgba(255, 255, 255, 0.22)' }}
          className="bg-zinc-950 border border-white/10 p-5 rounded-2xl shadow-lg transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold">In Progress / Review</span>
            <CheckSquare className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{stats.inProgress + stats.inReview}</p>
          <p className="text-[11px] text-zinc-500 mt-2">
            {stats.inProgress} active • {stats.inReview} under review
          </p>
          <p className="text-[10px] text-amber-400 mt-1">{stats.todo} tasks queued</p>
        </motion.div>

        {/* Card 4: Overdue Deadlines */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ y: -4, scale: 1.015, borderColor: 'rgba(255, 255, 255, 0.22)' }}
          className="bg-zinc-950 border border-white/10 p-5 rounded-2xl shadow-lg transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-semibold">Overdue Tasks</span>
            <AlertCircle className={`w-4 h-4 ${stats.overdue > 0 ? 'text-red-400' : 'text-zinc-500'}`} />
          </div>
          <p className={`text-3xl font-extrabold ${stats.overdue > 0 ? 'text-red-400' : 'text-white'}`}>
            {stats.overdue}
          </p>
          <p className="text-[11px] text-zinc-500 mt-2">
            {stats.overdue === 0 ? 'All deadlines on schedule' : 'Require immediate attention'}
          </p>
        </motion.div>
      </div>

      {/* Row 2: Status Breakdown & Priority Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Status Breakdown Card */}
        <div className="bg-zinc-950 border border-white/10 p-6 rounded-3xl space-y-5">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center justify-between">
            <span>Workflow Status Breakdown</span>
            <span className="text-xs font-normal text-zinc-400">{stats.total} Total Tasks</span>
          </h2>

          <div className="space-y-3">
            {[
              { label: 'Completed', count: stats.completed, color: 'bg-emerald-400', textColor: 'text-emerald-400' },
              { label: 'In Review', count: stats.inReview, color: 'bg-sky-400', textColor: 'text-sky-400' },
              { label: 'In Progress', count: stats.inProgress, color: 'bg-amber-400', textColor: 'text-amber-400' },
              { label: 'To Do', count: stats.todo, color: 'bg-zinc-500', textColor: 'text-zinc-400' }
            ].map((st) => {
              const pct = stats.total > 0 ? Math.round((st.count / stats.total) * 100) : 0;
              return (
                <div key={st.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 font-semibold">{st.label}</span>
                    <span className="text-zinc-400">
                      <strong className={st.textColor}>{st.count}</strong> ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.5 }}
                      className={`h-full ${st.color} rounded-full`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority Distribution Card */}
        <div className="bg-zinc-950 border border-white/10 p-6 rounded-3xl space-y-5">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center justify-between">
            <span>Priority Distribution</span>
            <span className="text-xs font-normal text-zinc-400">Impact Weighting</span>
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <motion.div
              whileHover={{ scale: 1.025, y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl cursor-default"
            >
              <span className="text-[10px] uppercase font-bold text-red-400 block">Urgent</span>
              <p className="text-2xl font-black text-white mt-1">{stats.urgent}</p>
              <p className="text-[10px] text-zinc-400 mt-1">Requires hotfix or priority review</p>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.025, y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl cursor-default"
            >
              <span className="text-[10px] uppercase font-bold text-amber-400 block">High</span>
              <p className="text-2xl font-black text-white mt-1">{stats.high}</p>
              <p className="text-[10px] text-zinc-400 mt-1">Core sprint commitments</p>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.025, y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl cursor-default"
            >
              <span className="text-[10px] uppercase font-bold text-indigo-400 block">Medium</span>
              <p className="text-2xl font-black text-white mt-1">{stats.medium}</p>
              <p className="text-[10px] text-zinc-400 mt-1">Standard feature roadmap</p>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.025, y: -2 }}
              transition={{ duration: 0.2 }}
              className="p-4 bg-zinc-900 border border-white/10 rounded-2xl cursor-default"
            >
              <span className="text-[10px] uppercase font-bold text-zinc-400 block">Low</span>
              <p className="text-2xl font-black text-white mt-1">{stats.low}</p>
              <p className="text-[10px] text-zinc-400 mt-1">Minor polish or backlog items</p>
            </motion.div>
          </div>
        </div>

      </div>

      {canViewCollaboratorWorkload && (
        <div className="bg-zinc-950 border border-white/10 rounded-3xl p-6 space-y-4 shadow-xl">
          {/* Row 3: Collaborator Workload Table */}
        <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-400" />
          <span>Collaborator Workload & Time Allocation</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 border-b border-white/10 text-zinc-400 uppercase text-[10px]">
              <tr>
                <th className="p-3.5">Collaborator</th>
                <th className="p-3.5">Assigned Tasks</th>
                <th className="p-3.5">Completed</th>
                <th className="p-3.5">Completion Rate</th>
                <th className="p-3.5">Hours Logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {memberWorkload.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-zinc-500">
                    No collaborators found in workspace.
                  </td>
                </tr>
              ) : (
                memberWorkload.map((m) => {
                  const rate = m.assignedCount > 0 ? Math.round((m.doneCount / m.assignedCount) * 100) : 0;
                  return (
                    <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-3.5 flex items-center gap-2.5 font-semibold text-white">
                        <img
                          src={m.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(m.name)}`}
                          alt={m.name}
                          className="w-7 h-7 rounded-full bg-zinc-800"
                        />
                        <div>
                          <span>{m.name}</span>
                          <span className="block text-[10px] text-zinc-500">{m.email}</span>
                        </div>
                      </td>
                      <td className="p-3.5 font-bold text-white">{m.assignedCount}</td>
                      <td className="p-3.5 text-emerald-400 font-semibold">{m.doneCount}</td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${rate}%` }} />
                          </div>
                          <span className="text-[11px] font-mono text-zinc-400">{rate}%</span>
                        </div>
                      </td>
                      <td className="p-3.5 font-mono text-indigo-300 font-semibold">{m.hoursLogged}h</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
