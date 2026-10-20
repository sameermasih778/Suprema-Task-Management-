import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  Server,
  Database,
  Users,
  UserCog,
  Bell,
  Activity as ActivityIcon,
  UserX,
  CheckCircle2,
  XCircle,
  FolderKanban,
  RefreshCw,
  Globe,
  ShieldAlert,
  Mail,
  Building2
} from 'lucide-react';
import {
  DashboardShell,
  DashboardBanner,
  StatCard,
  SectionCard,
  SectionLink,
  ActivityFeed,
  EmptyState,
  LoadingBlock
} from './DashboardShell';
import useDashboardData from '../../hooks/useDashboardData';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

function formatUptime(seconds) {
  if (!seconds && seconds !== 0) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Admin / Super Admin portal.
 *
 * Focus: platform health and user governance. Unlike the previous version, the
 * status tiles read from GET /health (which itself performs a live
 * `SELECT 1`) rather than hardcoded strings, so they cannot report "Online"
 * while the database is actually unreachable.
 */
export default function AdminDashboard() {
  const { user } = useAuth();
  const { workspaceName, projects, tasks, teams, activities, loading, error } =
    useDashboardData();

  const [users, setUsers] = useState([]);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [checking, setChecking] = useState(false);

  // Workspace invitations - only the count is needed here; the list with its
  // status and history lives on the Invitations page.
  const [invitations, setInvitations] = useState([]);

  const isSuperAdmin = user?.role === 'super_admin';

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await api.get('/admin/invitations');
      setInvitations(res.invitations || []);
    } catch {
      // Not a manager of this workspace - nothing to show.
      setInvitations([]);
    }
  }, []);

  const fetchAdminData = useCallback(async () => {
    setChecking(true);
    // Both calls are independent; a failure in one must not blank the other.
    const [usersRes, healthRes] = await Promise.allSettled([
      api.get('/admin/users'),
      api.get('/health')
    ]);

    if (usersRes.status === 'fulfilled') setUsers(usersRes.value.users || []);
    else setHealthError('Could not load user directory');

    if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
    else setHealthError((prev) => prev || 'Health endpoint unreachable');

    setChecking(false);
  }, []);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const safeUsers = Array.isArray(users) ? users : [];
  const roleCounts = safeUsers.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  const suspended = safeUsers.filter((u) => u.status === 'suspended').length;
  const pendingInvitations = invitations.filter((i) => i.status === 'pending').length;
  const dbUp = health?.database === 'CONNECTED';
  const apiUp = health?.status === 'UP';

  const healthRows = [
    {
      label: 'API server',
      value: health ? `Express · :${health.uptimeSeconds !== undefined ? '' : ''}5000` : '--',
      detail: health
        ? `${health.environment} · up ${formatUptime(health.uptimeSeconds)}`
        : 'Unreachable',
      ok: apiUp,
      icon: <Server className="h-4 w-4" />
    },
    {
      label: 'Database',
      value: health?.database || '--',
      detail: health
        ? `suprema_db · ${dbUp ? 'accepting queries' : 'not responding'}`
        : 'Unreachable',
      ok: dbUp,
      icon: <Database className="h-4 w-4" />
    },
    {
      label: 'Workspaces in view',
      value: projects.length ? 1 : 0,
      detail: workspaceName || 'No workspace selected',
      ok: true,
      icon: <FolderKanban className="h-4 w-4" />
    },
    {
      label: 'Tasks indexed',
      value: tasks.length,
      detail: `${teams.length} team${teams.length === 1 ? '' : 's'} in workspace`,
      ok: true,
      icon: <ActivityIcon className="h-4 w-4" />
    }
  ];

  return (
    <DashboardShell tier="admin">
      <DashboardBanner
        eyebrow={isSuperAdmin ? 'Super Admin Console' : 'Admin Console'}
        title={`Platform oversight · ${user?.name || 'Administrator'}`}
        subtitle="System health, the user directory, and the audit trail for this workspace."
        chips={[
          { label: `Role: ${user?.role || 'admin'}` },
          { label: health ? `env: ${health.environment}` : 'env: unknown' }
        ]}
        actions={[
          { to: '/dashboard/users', label: 'Manage users', icon: <UserCog className="h-4 w-4" /> },
          { to: '/', label: 'Public site', icon: <Globe className="h-4 w-4" /> }
        ]}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total users"
          value={users.length}
          hint="Across all workspaces"
          icon={<Users className="h-4 w-4" />}
          tone="accent"
          loading={checking}
        />
        <StatCard
          label="Active"
          value={users.filter((u) => u.status === 'active').length}
          hint="Can sign in"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="positive"
          loading={checking}
        />
        <StatCard
          label="Suspended"
          value={suspended}
          hint={suspended ? 'Blocked at login' : 'No suspensions'}
          icon={<UserX className="h-4 w-4" />}
          tone={suspended ? 'danger' : 'neutral'}
          loading={checking}
        />
        <StatCard
          label="Privileged"
          value={(roleCounts.super_admin || 0) + (roleCounts.admin || 0) + (roleCounts.developer || 0)}
          hint="Admin + developer roles"
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="warning"
          loading={checking}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SectionCard
            title="System health"
            icon={<Server className="h-4 w-4" />}
            action={
              <button
                onClick={fetchAdminData}
                disabled={checking}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${checking ? 'animate-spin' : ''}`} />
                Re-check
              </button>
            }
          >
            {healthError && !health ? (
              <EmptyState
                icon={<XCircle className="h-6 w-6" />}
                title="Health check failed"
                hint={healthError}
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {healthRows.map((row) => (
                  <motion.li
                    key={row.label}
                    whileHover={{ y: -3, scale: 1.015 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 transition-colors hover:border-white/20 cursor-default shadow-lg"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        <span className="text-[color:var(--accent)]">{row.icon}</span>
                        {row.label}
                      </span>
                      {row.ok ? (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
                          <span className="relative flex h-2 w-2">
                            <motion.span
                              animate={{ scale: [1, 2, 1], opacity: [0.75, 0, 0.75] }}
                              transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                              className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                            />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                          Healthy
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-400">
                          <span className="relative flex h-2 w-2">
                            <motion.span
                              animate={{ scale: [1, 2, 1], opacity: [0.75, 0, 0.75] }}
                              transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                              className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"
                            />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                          </span>
                          Down
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-white">{row.value}</p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">{row.detail}</p>
                  </motion.li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="User directory"
            icon={<Users className="h-4 w-4" />}
            action={<SectionLink to="/dashboard/users" label="Open user management" />}
          >
            {checking && users.length === 0 ? (
              <LoadingBlock label="Loading user directory..." />
            ) : users.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title="No users returned"
                hint="The directory endpoint returned nothing."
              />
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {users.slice(0, 8).map((u) => (
                  <motion.li 
                    key={u.id} 
                    whileHover={{ x: 3 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center justify-between gap-3 py-2.5 px-2 rounded-lg transition-colors hover:bg-white/[0.03] first:pt-2 last:pb-2 cursor-pointer"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-[10px] font-black text-white">
                        {u.name?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-white">
                          {u.name}
                        </span>
                        <span className="block truncate text-[10px] text-zinc-500">{u.email}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase text-zinc-400">
                        {String(u.role).replace('_', ' ')}
                      </span>
                      {u.status !== 'active' && (
                        <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase text-red-400">
                          {u.status}
                        </span>
                      )}
                    </span>
                  </motion.li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Administrative actions" icon={<ShieldCheck className="h-4 w-4" />}>
            <div className="space-y-2">
              <Link
                to="/dashboard/users"
                className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3 transition-colors hover:border-[color:var(--accent-ring)]"
              >
                <span>
                  <span className="block text-xs font-semibold text-white">User management</span>
                  <span className="block text-[11px] text-zinc-500">
                    Roles, suspend, password reset
                  </span>
                </span>
                <UserCog className="h-4 w-4 text-zinc-600" />
              </Link>

              <Link
                to="/dashboard/users"
                className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3 transition-colors hover:border-[color:var(--accent-ring)]"
              >
                <span>
                  <span className="block text-xs font-semibold text-white">Send notification</span>
                  <span className="block text-[11px] text-zinc-500">Everyone or one user</span>
                </span>
                <Bell className="h-4 w-4 text-zinc-600" />
              </Link>

              <Link
                to="/dashboard/workspaces"
                className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3 transition-colors hover:border-[color:var(--accent-ring)]"
              >
                <span>
                  <span className="block text-xs font-semibold text-white">Workspaces</span>
                  <span className="block text-[11px] text-zinc-500">
                    Create, freeze or remove a workspace
                  </span>
                </span>
                <Building2 className="h-4 w-4 text-zinc-600" />
              </Link>

              <Link
                to="/dashboard/invitations"
                className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3 transition-colors hover:border-[color:var(--accent-ring)]"
              >
                <span>
                  <span className="block text-xs font-semibold text-white">Invitations</span>
                  <span className="block text-[11px] text-zinc-500">
                    {pendingInvitations} awaiting a reply
                  </span>
                </span>
                <Mail className="h-4 w-4 text-zinc-600" />
              </Link>

              <Link
                to="/dashboard/activity"
                className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/50 px-4 py-3 transition-colors hover:border-[color:var(--accent-ring)]"
              >
                <span>
                  <span className="block text-xs font-semibold text-white">Audit trail</span>
                  <span className="block text-[11px] text-zinc-500">
                    {activities.length} entries recorded
                  </span>
                </span>
                <ActivityIcon className="h-4 w-4 text-zinc-600" />
              </Link>
            </div>

            {!isSuperAdmin && (
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-200/80">
                <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                Account deletion is restricted to super admins.
              </p>
            )}
          </SectionCard>

          {/* The invitation list with its status and history lives on the
              dedicated Invitations page (/dashboard/invitations). The button
              above is the way there - it is not repeated here. */}

          <SectionCard title="Audit trail" icon={<ActivityIcon className="h-4 w-4" />}>
            {loading ? (
              <LoadingBlock label="Loading audit trail..." />
            ) : error ? (
              <EmptyState title="Could not load activity" hint={error} />
            ) : (
              <ActivityFeed
                activities={activities}
                limit={10}
                emptyHint="No audit entries for this workspace yet."
              />
            )}
          </SectionCard>
        </div>
      </div>
    </DashboardShell>
  );
}