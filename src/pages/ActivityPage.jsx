import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import Avatar from '../components/Avatar';
import {
  Activity,
  CheckCircle2,
  Clock,
  User,
  FolderKanban,
  Users,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  Filter,
  CheckSquare,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function ActivityPage() {
  const { activeWorkspace } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'task' | 'team' | 'project' | 'member'
  const [refreshing, setRefreshing] = useState(false);

  const fetchActivities = async () => {
    if (!activeWorkspace?.id) return;
    try {
      const data = await api.get(`/activity?workspace_id=${activeWorkspace.id}`);
      setActivities(data.activities || []);
    } catch (err) {
      console.warn('Failed to fetch activity logs:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchActivities();
  }, [activeWorkspace?.id]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchActivities();
  };

  // Helper to get action icon and styling
  const getActivityStyle = (action, entityType) => {
    if (action.includes('STATUS') || action.includes('COMPLETED')) {
      return {
        icon: CheckCircle2,
        bg: 'bg-emerald-500/15',
        border: 'border-emerald-500/30',
        text: 'text-emerald-400'
      };
    }
    if (action.includes('SUBTASK')) {
      return {
        icon: CheckSquare,
        bg: 'bg-cyan-500/15',
        border: 'border-cyan-500/30',
        text: 'text-cyan-400'
      };
    }
    if (action.includes('TASK')) {
      return {
        icon: CheckSquare,
        bg: 'bg-indigo-500/15',
        border: 'border-indigo-500/30',
        text: 'text-indigo-400'
      };
    }
    if (action.includes('TEAM') || action.includes('MEMBER')) {
      return {
        icon: Users,
        bg: 'bg-purple-500/15',
        border: 'border-purple-500/30',
        text: 'text-purple-400'
      };
    }
    if (action.includes('PROJECT')) {
      return {
        icon: FolderKanban,
        bg: 'bg-blue-500/15',
        border: 'border-blue-500/30',
        text: 'text-blue-400'
      };
    }
    return {
      icon: Activity,
      bg: 'bg-zinc-800',
      border: 'border-white/10',
      text: 'text-zinc-400'
    };
  };

  // Format action text
  const formatActionText = (item) => {
    let details = item.details;
    if (typeof details === 'string') {
      try { details = JSON.parse(details); } catch (e) { details = {}; }
    }
    details = details || {};

    switch (item.action) {
      case 'TASK_CREATED':
        return `created task "${details.title || 'Untitled Task'}"`;
      case 'SUBTASK_CREATED':
        return `added subtask "${details.title || 'Checklist item'}"`;
      case 'TASK_UPDATED':
        return `updated task details for "${details.title || 'Task'}"`;
      case 'TASK_STATUS_UPDATED':
        return `moved task "${details.title || 'Task'}" to ${details.new_status?.replace('_', ' ').toUpperCase()}`;
      case 'SUBTASK_STATUS_UPDATED':
        return `marked subtask "${details.title || 'Subtask'}" as ${details.new_status?.toUpperCase()}`;
      case 'TASK_DELETED':
        return `deleted task "${details.title || 'Task'}"`;
      case 'SUBTASK_DELETED':
        return `removed subtask "${details.title || 'Subtask'}"`;
      case 'TEAM_CREATED':
        return `created department squad "${details.name || 'Team'}"`;
      case 'TEAM_MEMBER_ADDED':
        return `assigned a collaborator to team "${details.team_name || 'Team'}"`;
      case 'TEAM_MEMBER_REMOVED':
        return `removed a collaborator from team "${details.team_name || 'Team'}"`;
      case 'MEMBER_JOINED':
        return `invited ${details.member_name || details.member_email} as ${details.role || 'member'}`;
      case 'PROJECT_CREATED':
        return `created project "${details.name || 'Project'}"`;
      default:
        return item.action.toLowerCase().replace(/_/g, ' ');
    }
  };

  const filteredActivities = activities.filter((act) => {
    if (filterType === 'all') return true;
    if (filterType === 'task') return act.entity_type === 'task';
    if (filterType === 'team') return act.entity_type === 'team';
    if (filterType === 'project') return act.entity_type === 'project';
    if (filterType === 'member') return act.action.includes('MEMBER') || act.entity_type === 'workspace';
    return true;
  });

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-400" />
            Workspace Activity Audit Trail
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time chronological timeline of team modifications, task updates, and squad assignments in{' '}
            <span className="text-white font-semibold">{activeWorkspace?.name || 'Workspace'}</span>.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${refreshing ? 'animate-spin text-white' : ''}`} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh Feed'}</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {[
          { key: 'all', label: 'All Activities' },
          { key: 'task', label: 'Tasks & Checklist' },
          { key: 'team', label: 'Teams & Squads' },
          { key: 'member', label: 'Collaborator Invites' },
          { key: 'project', label: 'Projects' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterType(tab.key)}
            className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all cursor-pointer border ${
              filterType === tab.key
                ? 'bg-white text-black border-white shadow-sm'
                : 'bg-zinc-950 text-zinc-400 border-white/10 hover:border-white/20 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Activities Timeline Feed */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 bg-zinc-900/40 rounded-2xl animate-pulse border border-white/5" />
          ))}
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="p-12 border border-dashed border-white/10 rounded-3xl text-center space-y-3 bg-zinc-950/40">
          <Activity className="w-10 h-10 text-zinc-600 mx-auto" />
          <h3 className="text-sm font-semibold text-white">No activity records found</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            Changes such as creating tasks, checking off subtasks, or inviting team members will automatically appear here.
          </p>
        </div>
      ) : (
        <div className="relative border-l border-white/10 ml-4 sm:ml-6 space-y-6 pl-6 sm:pl-8">
          {filteredActivities.map((act, index) => {
            const style = getActivityStyle(act.action, act.entity_type);
            const Icon = style.icon;

            return (
              <motion.div
                key={act.id || index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                className="relative group"
              >
                {/* Node icon on line */}
                <div
                  className={`absolute -left-[37px] sm:-left-[45px] top-1.5 w-7 h-7 rounded-full border flex items-center justify-center ${style.bg} ${style.border} ${style.text} shadow-md`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>

                {/* Card */}
                <div className="p-4 bg-zinc-950 border border-white/10 hover:border-white/20 rounded-2xl space-y-2 transition-all shadow-lg group-hover:bg-zinc-900/40">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        person={{
                          name: act.user_name,
                          avatar_url: act.user_avatar,
                          user_role: act.user_role
                        }}
                        roleKey="user_role"
                        alt={act.user_name || 'User'}
                        className="w-6 h-6 rounded-full bg-zinc-800 border border-white/10"
                      />
                      <span className="text-xs font-bold text-white">
                        {act.user_name || 'System / Admin'}
                      </span>
                      <span className="text-xs text-zinc-300">
                        {formatActionText(act)}
                      </span>
                    </div>

                    <span className="text-[10px] text-zinc-500 font-medium">
                      {new Date(act.created_at).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>

                  {/* Optional JSON details pill */}
                  {act.details && (
                    <div className="pt-1 flex items-center gap-2 flex-wrap text-[11px] text-zinc-400">
                      <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 font-mono text-[10px] text-zinc-400">
                        Entity: {act.entity_type} #{act.entity_id || 'N/A'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 font-mono text-[10px] text-zinc-500">
                        Action: {act.action}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
