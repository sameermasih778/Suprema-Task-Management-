import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import Avatar from '../components/Avatar';
import {
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  RefreshCw,
  ArrowLeft,
  ShieldCheck,
  History
} from 'lucide-react';

/**
 * Staff view of every workspace invitation on the platform.
 *
 * An invitation is a request to join a workspace. This page answers the
 * question an admin actually has: who was invited where, by whom, and what
 * happened - accepted, declined, or never answered.
 */

const STATUS_STYLES = {
  pending: {
    label: 'Pending',
    icon: Clock,
    chip: 'bg-amber-500/15 border-amber-500/30 text-amber-400'
  },
  accepted: {
    label: 'Accepted',
    icon: CheckCircle2,
    chip: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
  },
  rejected: {
    label: 'Declined',
    icon: XCircle,
    chip: 'bg-zinc-800 border-white/10 text-zinc-400'
  }
};

const HISTORY_LABELS = {
  WORKSPACE_INVITATION_SENT: 'Invitation sent',
  WORKSPACE_INVITATION_ACCEPTED: 'Invitation accepted',
  WORKSPACE_INVITATION_REJECTED: 'Invitation declined'
};

const formatDate = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, accepted: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);

  const fetchInvitations = async () => {
    try {
      const data = await api.get('/admin/invitations');
      setInvitations(data.invitations || []);
      setSummary(data.summary || { total: 0, pending: 0, accepted: 0, rejected: 0 });
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load invitations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchInvitations();
  };

  const visible = invitations.filter((i) => filter === 'all' || i.status === filter);

  const filters = [
    { key: 'all', label: 'All', count: summary.total },
    { key: 'pending', label: 'Pending', count: summary.pending },
    { key: 'accepted', label: 'Accepted', count: summary.accepted },
    { key: 'rejected', label: 'Declined', count: summary.rejected }
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white">
            <Mail className="h-6 w-6 text-indigo-400" />
            Invitations
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Every request to join a workspace, and what happened to it.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
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

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-2xl border p-4 text-left transition-colors cursor-pointer ${
              filter === f.key
                ? 'border-indigo-500/40 bg-indigo-500/10'
                : 'border-white/10 bg-zinc-950 hover:border-white/20'
            }`}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {f.label}
            </p>
            <p className="mt-1 text-2xl font-extrabold text-white">{f.count}</p>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              filter === f.key
                ? 'bg-white text-black'
                : 'bg-white/5 text-zinc-400 hover:text-white'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          <XCircle className="mt-px h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-8 text-center text-xs text-zinc-500">
          Loading invitations...
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-zinc-700" />
          <p className="mt-3 text-sm font-semibold text-white">No invitations yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            When someone is invited to a workspace, it will show up here with its status.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((inv) => {
            const style = STATUS_STYLES[inv.status] || STATUS_STYLES.pending;
            const StatusIcon = style.icon;
            const isOpen = expanded === inv.id;

            return (
              <div
                key={inv.id}
                className="rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-lg"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      person={{
                        name: inv.invitee_name,
                        avatar_url: inv.invitee_avatar,
                        global_role: inv.invitee_role
                      }}
                      roleKey="global_role"
                      alt={inv.invitee_name}
                      className="h-10 w-10 flex-shrink-0 rounded-full bg-zinc-800 border border-white/10"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">
                        {inv.invitee_name || inv.email}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {inv.email} · invited to{' '}
                        <span className="text-zinc-300">{inv.workspace_name}</span> as{' '}
                        <span className="capitalize">{inv.role}</span>
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-zinc-600">
                        by {inv.inviter_name || 'an administrator'} · {formatDate(inv.created_at)}
                        {inv.responded_at ? ` · answered ${formatDate(inv.responded_at)}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 sm:flex-shrink-0">
                    {inv.invited_by_me && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase text-zinc-400">
                        Sent by you
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${style.chip}`}
                    >
                      <StatusIcon className="h-3 w-3" />
                      {style.label}
                    </span>
                    <button
                      onClick={() => setExpanded(isOpen ? null : inv.id)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-white"
                    >
                      <History className="h-3.5 w-3.5" />
                      History
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-4 border-t border-white/[0.06] pt-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      History
                    </p>
                    {inv.history?.length ? (
                      <ol className="space-y-2">
                        {inv.history.map((h) => (
                          <li key={h.id} className="flex items-start gap-2.5 text-[11px]">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                            <span className="text-zinc-300">
                              {HISTORY_LABELS[h.action] || h.action.replace(/_/g, ' ').toLowerCase()}{' '}
                              <span className="text-zinc-500">
                                — {h.actor_name || 'System'} · {formatDate(h.created_at)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-[11px] text-zinc-500">No history recorded yet.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-zinc-950 p-3 text-[11px] text-zinc-500">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-400" />
        A person only becomes a member of a workspace once they accept. Declining
        records the decision and leaves the workspace untouched.
      </p>
    </div>
  );
}
