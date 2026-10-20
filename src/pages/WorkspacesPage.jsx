import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import Avatar from '../components/Avatar';
import { useAuth } from '../context/AuthContext';
import {
  Building2,
  Plus,
  Mail,
  Archive,
  ArchiveRestore,
  Trash2,
  Users,
  CheckSquare,
  RefreshCw,
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from 'lucide-react';

/**
 * Admin management of workspaces.
 *
 * A workspace is a tenant - it owns teams, projects and tasks. So this page
 * is careful about the destructive action: archiving freezes a workspace and
 * keeps every row of data, while a permanent delete destroys the lot and has
 * to be confirmed by typing the workspace name.
 */

const PLAN_STYLES = {
  free: 'bg-zinc-800 text-zinc-300 border-white/10',
  pro: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  enterprise: 'bg-amber-500/15 text-amber-400 border-amber-500/30'
};

const PlanBadge = ({ plan }) => (
  <span
    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
      PLAN_STYLES[plan] || PLAN_STYLES.free
    }`}
  >
    {plan}
  </span>
);

const formatDate = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function WorkspacesPage() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, archived: 0, pendingInvitations: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Create modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState('free');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [creating, setCreating] = useState(false);

  // Invite modal
  const [inviteTarget, setInviteTarget] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [impact, setImpact] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Permanent deletion is reserved for super admins, matching the rule the
  // backend enforces for deleting a user.
  const isSuperAdmin = user?.role === 'super_admin';

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data = await api.get('/admin/workspaces');
      setWorkspaces(data.workspaces || []);
      setSummary(data.summary || { total: 0, active: 0, archived: 0, pendingInvitations: 0 });
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load workspaces');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchWorkspaces();
  };

  const flash = (text, kind = 'success') => {
    setNotice({ text, kind });
    setTimeout(() => setNotice(null), 4000);
  };

  // ── Create ────────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/admin/workspaces', {
        name: newName.trim(),
        plan: newPlan,
        ownerEmail: newOwnerEmail.trim() || undefined
      });
      flash(res.message || 'Workspace created');
      setIsCreateOpen(false);
      setNewName('');
      setNewPlan('free');
      setNewOwnerEmail('');
      fetchWorkspaces();
    } catch (err) {
      flash(err.message || 'Could not create the workspace', 'error');
    } finally {
      setCreating(false);
    }
  };

  // ── Invite ────────────────────────────────────────────────────────────
  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteTarget) return;
    setSendingInvite(true);
    try {
      const res = await api.post(`/workspaces/${inviteTarget.id}/invitations`, {
        email: inviteEmail.trim(),
        role: inviteRole
      });
      flash(res.message || 'Invitation sent');
      setInviteTarget(null);
      setInviteEmail('');
      setInviteRole('member');
      fetchWorkspaces();
    } catch (err) {
      flash(err.message || 'Could not send the invitation', 'error');
    } finally {
      setSendingInvite(false);
    }
  };

  // ── Archive / restore ─────────────────────────────────────────────────
  const handleArchive = async (ws) => {
    try {
      const res = await api.post(`/admin/workspaces/${ws.id}/archive`);
      flash(res.message || 'Workspace archived');
      fetchWorkspaces();
    } catch (err) {
      flash(err.message || 'Could not archive the workspace', 'error');
    }
  };

  const handleRestore = async (ws) => {
    try {
      const res = await api.post(`/admin/workspaces/${ws.id}/restore`);
      flash(res.message || 'Workspace restored');
      fetchWorkspaces();
    } catch (err) {
      flash(err.message || 'Could not restore the workspace', 'error');
    }
  };

  // ── Permanent delete ──────────────────────────────────────────────────
  const openDelete = async (ws) => {
    setDeleteTarget(ws);
    setConfirmText('');
    setImpact(null);
    try {
      const res = await api.get(`/admin/workspaces/${ws.id}/deletion-impact`);
      setImpact(res);
    } catch (err) {
      flash(err.message || 'Could not work out what would be deleted', 'error');
      setDeleteTarget(null);
    }
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/admin/workspaces/${deleteTarget.id}`, {
        confirm: confirmText
      });
      flash(res.message || 'Workspace deleted');
      setDeleteTarget(null);
      fetchWorkspaces();
    } catch (err) {
      flash(err.message || 'Could not delete the workspace', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const tiles = [
    { label: 'Workspaces', value: summary.total, icon: Building2 },
    { label: 'Active', value: summary.active, icon: CheckSquare },
    { label: 'Archived', value: summary.archived, icon: Archive },
    { label: 'Pending invites', value: summary.pendingInvitations, icon: Mail }
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white">
            <Building2 className="h-6 w-6 text-indigo-400" />
            Workspaces
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Every organisation on the platform. Create them, invite people in, freeze them or remove them.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-black transition-colors hover:bg-zinc-200"
          >
            <Plus className="h-3.5 w-3.5" />
            New workspace
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/dashboard"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        </div>
      </div>

      {notice && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
            notice.kind === 'error'
              ? 'border-red-500/25 bg-red-500/10 text-red-300'
              : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {notice.kind === 'error' ? (
            <XCircle className="mt-px h-4 w-4 shrink-0" />
          ) : (
            <ShieldCheck className="mt-px h-4 w-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          <XCircle className="mt-px h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/10 bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {t.label}
              </p>
              <t.icon className="h-3.5 w-3.5 text-zinc-600" />
            </div>
            <p className="mt-1 text-2xl font-extrabold text-white">{t.value}</p>
          </div>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-8 text-center text-xs text-zinc-500">
          Loading workspaces...
        </div>
      ) : workspaces.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-zinc-700" />
          <p className="mt-3 text-sm font-semibold text-white">No workspaces yet</p>
          <p className="mt-1 text-xs text-zinc-500">Create the first one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className={`rounded-2xl border bg-zinc-950 p-5 ${
                ws.status === 'archived'
                  ? 'border-amber-500/20 opacity-80'
                  : 'border-white/10'
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    person={{
                      name: ws.owner_name,
                      avatar_url: ws.owner_avatar,
                      global_role: 'member'
                    }}
                    roleKey="global_role"
                    alt={ws.owner_name || 'Owner'}
                    className="h-10 w-10 shrink-0 rounded-xl bg-zinc-800"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-white">{ws.name}</p>
                      <PlanBadge plan={ws.plan} />
                      {ws.status === 'archived' && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-400">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      Owner: {ws.owner_name || '—'} · Created {formatDate(ws.created_at)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-center">
                  <div>
                    <p className="text-base font-bold text-white">{ws.member_count}</p>
                    <p className="text-[10px] text-zinc-600">Members</p>
                  </div>
                  <div>
                    <p className="text-base font-bold text-white">{ws.project_count}</p>
                    <p className="text-[10px] text-zinc-600">Projects</p>
                  </div>
                  <div>
                    <p className="text-base font-bold text-white">{ws.task_count}</p>
                    <p className="text-[10px] text-zinc-600">Tasks</p>
                  </div>
                  {ws.pending_invitations > 0 && (
                    <div>
                      <p className="text-base font-bold text-amber-400">
                        {ws.pending_invitations}
                      </p>
                      <p className="text-[10px] text-zinc-600">Invited</p>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setInviteTarget(ws);
                        setInviteEmail('');
                        setInviteRole('member');
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-white"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Invite
                    </button>

                    {ws.status === 'archived' ? (
                      <button
                        onClick={() => handleRestore(ws)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" />
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => handleArchive(ws)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-white"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Archive
                      </button>
                    )}

                    {isSuperAdmin && (
                      <button
                        onClick={() => openDelete(ws)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-zinc-950 p-3 text-[11px] text-zinc-500">
        <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span>
          Archiving freezes a workspace and keeps every row of data - it can be
          restored at any time. Deleting one is permanent and destroys its
          projects, tasks and comments, so it is reserved for super admins and
          has to be confirmed by typing the workspace name.
          {!isSuperAdmin && (
            <>
              {' '}
              <span className="text-amber-300/90">
                You can create, invite and archive - a super admin does the
                permanent deletes.
              </span>
            </>
          )}
        </span>
      </p>

      {/* ── Create modal ── */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md space-y-4 rounded-2xl border border-white/15 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Building2 className="h-5 w-5 text-indigo-400" />
                New workspace
              </h2>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="cursor-pointer rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Workspace name *
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme Corporation"
                className="w-full rounded-xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-white/30 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Plan
              </label>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="w-full cursor-pointer rounded-xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Owner email (optional)
              </label>
              <input
                type="email"
                value={newOwnerEmail}
                onChange={(e) => setNewOwnerEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full rounded-xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-white/30 focus:outline-none"
              />
              <p className="text-[10px] text-zinc-500">
                If this person has an account they are invited to own it and
                become a member when they accept. Leave it empty and you will
                own the workspace yourself.
              </p>
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="cursor-pointer rounded-xl bg-white px-5 py-2 text-xs font-bold text-black transition-colors hover:bg-zinc-200 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create workspace'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Invite modal ── */}
      {inviteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleInvite}
            className="w-full max-w-md space-y-4 rounded-2xl border border-white/15 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Users className="h-5 w-5 text-indigo-400" />
                Invite to &ldquo;{inviteTarget.name}&rdquo;
              </h2>
              <button
                type="button"
                onClick={() => setInviteTarget(null)}
                className="cursor-pointer rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Email
              </label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full rounded-xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-white/30 focus:outline-none"
              />
              <p className="text-[10px] text-zinc-500">
                They must already have an account. They will be asked to accept
                before they join.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Workspace role
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full cursor-pointer rounded-xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                <option value="member">Member (can create &amp; manage tasks)</option>
                <option value="admin">Admin (can manage projects, teams &amp; settings)</option>
                <option value="guest">Guest (read-only access)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setInviteTarget(null)}
                className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sendingInvite || !inviteEmail.trim()}
                className="cursor-pointer rounded-xl bg-white px-5 py-2 text-xs font-bold text-black transition-colors hover:bg-zinc-200 disabled:opacity-50"
              >
                {sendingInvite ? 'Sending...' : 'Send invitation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Permanent delete modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleDelete}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-red-500/30 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Trash2 className="h-5 w-5 text-red-400" />
                Delete workspace permanently
              </h2>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="cursor-pointer rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3">
              <p className="text-xs font-bold text-red-300">
                This cannot be undone. Archiving would keep all the data.
              </p>
              {impact?.impact && (
                <ul className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-red-200/80">
                  <li>{impact.impact.members} members</li>
                  <li>{impact.impact.teams} teams</li>
                  <li>{impact.impact.projects} projects</li>
                  <li>{impact.impact.tasks} tasks</li>
                  <li>{impact.impact.comments} comments</li>
                  <li>{impact.impact.attachments} attachments</li>
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Type <span className="text-white">{deleteTarget.name}</span> to confirm
              </label>
              <input
                type="text"
                required
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={deleteTarget.name}
                className="w-full rounded-xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-white/30 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deleting || confirmText !== deleteTarget.name}
                className="cursor-pointer rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
