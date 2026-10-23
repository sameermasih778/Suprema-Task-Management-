import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import Avatar from '../components/Avatar';
import {
  Users,
  Plus,
  Shield,
  Mail,
  UserPlus,
  X,
  Trash2,
  Check,
  ChevronRight,
  FolderKanban,
  Search,
  UserCheck,
  Crown,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

export default function TeamsPage() {
  const { user, activeWorkspace } = useAuth();
  const [teams, setTeams] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchMember, setSearchMember] = useState('');

  // Modals
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [isInviteMemberOpen, setIsInviteMemberOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null); // For team detail modal
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false);

  // Form states
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [submittingTeam, setSubmittingTeam] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null); // { type: 'success' | 'error', text }

  // Assign member to team state
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('member');
  const [submittingAssign, setSubmittingAssign] = useState(false);

  // Invitations state
  // myInvitations - requests addressed to ME (accept / decline). The list of
  // invitations this workspace SENT, with their status, lives on the staff
  // Invitations page instead.
  const [myInvitations, setMyInvitations] = useState([]);
  const [respondingToId, setRespondingToId] = useState(null);

  const canManage = ['super_admin', 'admin', 'member'].includes(user?.role);
  const isStaff = ['super_admin', 'admin', 'developer'].includes(user?.role);
  // Only the workspace owner, a workspace admin, or staff may invite new
  // members to THIS workspace. A member who was invited in cannot invite
  // others to that workspace - only to a workspace they own themselves.
  const canInviteToWorkspace =
    isStaff || ['owner', 'admin'].includes(activeWorkspace?.role);

  // A notification links straight to the invitation it is about, so the
  // matching card is highlighted when the page is opened from the bell.
  const [searchParams] = useSearchParams();
  const highlightedInvitationId = searchParams.get('invitation');
  const pendingInvitations = myInvitations.filter((i) => i.status === 'pending');
  // Controls inside the team modal are gated PER TEAM: staff can manage any
  // team, a non-staff user only the team they created. The backend enforces
  // the same rule; this just keeps the UI honest about it.
  const canManageThisTeam =
    selectedTeam != null &&
    (isStaff || Number(selectedTeam.created_by) === Number(user?.id));

  const fetchData = async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    try {
      const [teamsRes, memRes, myRes] = await Promise.all([
        api.get(`/teams?workspace_id=${activeWorkspace.id}`),
        api.get(`/workspaces/${activeWorkspace.id}/members`),
        api.get('/teams/mine')
      ]);
      setTeams(teamsRes.teams || []);
      setMembers(memRes.members || []);
      setMyTeams(myRes.teams || []);
    } catch (err) {
      console.warn('Error fetching teams/members:', err.message);
    } finally {
      setLoading(false);
    }
  };

  // The invitations addressed to me. The full platform-wide list, with each
  // invitation's status and history, is on the staff Invitations page.
  const fetchInvitations = async () => {
    try {
      const mine = await api.get('/invitations');
      setMyInvitations(mine.invitations || []);
    } catch (err) {
      console.warn('Error fetching invitations:', err.message);
    }
  };

  useEffect(() => {
    fetchData();
    fetchInvitations();
  }, [activeWorkspace?.id]);

  // Accept or decline an invitation. Accepting is what actually makes the
  // person a member of the workspace.
  const handleRespondInvitation = async (invitationId, action) => {
    setRespondingToId(invitationId);
    try {
      const res = await api.post(`/invitations/${invitationId}/respond`, { action });
      if (res.success) {
        setInviteMsg({ type: 'success', text: res.message });
        await fetchInvitations();
        fetchData();
      }
    } catch (err) {
      setInviteMsg({
        type: 'error',
        text: err.message || 'Could not respond to the invitation.'
      });
    } finally {
      setRespondingToId(null);
    }
  };

  // Create Team
  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!teamName.trim() || !activeWorkspace?.id) return;
    setSubmittingTeam(true);
    try {
      const res = await api.post('/teams', {
        workspace_id: activeWorkspace.id,
        name: teamName.trim(),
        description: teamDesc.trim() || null
      });
      if (res.success) {
        setTeamName('');
        setTeamDesc('');
        setIsCreateTeamOpen(false);
        fetchData();
      }
    } catch (err) {
      alert(err.message || 'Failed to create team');
    } finally {
      setSubmittingTeam(false);
    }
  };

  // Invite Member to Workspace.
  // This sends a REQUEST. The person becomes a member only once they accept,
  // so there is no silent add and they are told it happened.
  const handleInviteMember = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !activeWorkspace?.id) return;
    setSubmittingInvite(true);
    setInviteMsg(null);
    try {
      const res = await api.post(`/workspaces/${activeWorkspace.id}/invitations`, {
        email: inviteEmail.trim(),
        role: inviteRole
      });
      if (res.success) {
        setInviteMsg({ type: 'success', text: res.message || 'Invitation sent!' });
        setInviteEmail('');
        fetchInvitations();
        setTimeout(() => {
          setIsInviteMemberOpen(false);
          setInviteMsg(null);
        }, 1500);
      }
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message || 'Failed to invite member' });
    } finally {
      setSubmittingInvite(false);
    }
  };

  // Open Team Details
  const handleOpenTeamModal = async (team) => {
    setSelectedTeam(team);
    setLoadingTeamMembers(true);
    try {
      const res = await api.get(`/teams/${team.id}/members`);
      setTeamMembers(res.members || []);
    } catch (err) {
      console.warn('Failed to fetch team members:', err.message);
    } finally {
      setLoadingTeamMembers(false);
    }
  };

  // Assign user to team
  const handleAssignUserToTeam = async (e) => {
    e.preventDefault();
    if (!assignUserId || !selectedTeam?.id) return;
    setSubmittingAssign(true);
    try {
      const res = await api.post(`/teams/${selectedTeam.id}/members`, {
        user_id: Number(assignUserId),
        role: assignRole
      });
      if (res.success) {
        setAssignUserId('');
        // Refresh team members
        const membersRes = await api.get(`/teams/${selectedTeam.id}/members`);
        setTeamMembers(membersRes.members || []);
        fetchData();
      }
    } catch (err) {
      alert(err.message || 'Failed to add member to team');
    } finally {
      setSubmittingAssign(false);
    }
  };

  // Remove member from team
  const handleRemoveTeamMember = async (userId) => {
    if (!selectedTeam?.id) return;
    try {
      await api.delete(`/teams/${selectedTeam.id}/members/${userId}`);
      setTeamMembers(prev => prev.filter(m => m.id !== userId));
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to remove member');
    }
  };

  // Delete Team
  const handleDeleteTeam = async (teamId) => {
    if (!window.confirm('Are you sure you want to delete this team?')) return;
    try {
      await api.delete(`/teams/${teamId}`);
      setSelectedTeam(null);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to delete team');
    }
  };

  const filteredMembers = members.filter(m =>
    m.name?.toLowerCase().includes(searchMember.toLowerCase()) ||
    m.email?.toLowerCase().includes(searchMember.toLowerCase())
  );

  return (
    <div className="space-y-8 pb-12">
      {/* Header with Title and Top Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-400" />
            Teams & Collaborators
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage department squads, workspace collaborators, and role assignments in{' '}
            <span className="text-white font-semibold">{activeWorkspace?.name || 'Workspace'}</span>.
          </p>
        </div>

        {canInviteToWorkspace && (
          <div className="flex items-center gap-2.5">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setIsInviteMemberOpen(true)}
              className="bg-zinc-900 hover:bg-zinc-850 text-white border border-white/10 text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm"
            >
              <UserPlus className="w-4 h-4 text-zinc-400" />
              <span>Invite Member</span>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setIsCreateTeamOpen(true)}
              className="bg-white hover:bg-zinc-200 text-black text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-2 transition-all shadow-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Team</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* SECTION 0: INVITATIONS - requests to join, and how they went   */}
      {/* ================================================================ */}
      {pendingInvitations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <Mail className="w-4 h-4 text-indigo-400" />
              <span>Invitations for you</span>
              <span className="text-[10px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold px-2 py-0.5 rounded-full">
                {pendingInvitations.length}
              </span>
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] text-zinc-500">
                You are not a member until you accept
              </span>
              {isStaff && (
                <Link
                  to="/dashboard/invitations"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-semibold text-zinc-400 transition-colors hover:text-white"
                >
                  <UserCheck className="h-3 w-3" />
                  All invitations &amp; their status
                </Link>
              )}
            </div>
          </div>

          {pendingInvitations.map((inv) => (
            <div
              key={inv.id}
              className={`bg-zinc-950 border border-indigo-500/25 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between ${
                highlightedInvitationId === String(inv.id)
                  ? 'ring-2 ring-indigo-500/50'
                  : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  person={{
                    name: inv.inviter_name,
                    avatar_url: inv.inviter_avatar,
                    global_role: 'member'
                  }}
                  roleKey="global_role"
                  alt={inv.inviter_name || 'Inviter'}
                  className="w-10 h-10 rounded-full bg-zinc-800 flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{inv.workspace_name}</p>
                  <p className="text-[11px] text-zinc-400">
                    {inv.inviter_name || 'An administrator'} invited you to join as{' '}
                    <span className="text-zinc-200 font-semibold capitalize">{inv.role}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 flex-shrink-0">
                <button
                  onClick={() => handleRespondInvitation(inv.id, 'reject')}
                  disabled={respondingToId === inv.id}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl border border-white/10 hover:bg-zinc-900 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Decline
                </button>
                <button
                  onClick={() => handleRespondInvitation(inv.id, 'accept')}
                  disabled={respondingToId === inv.id}
                  className="px-5 py-2 text-xs font-bold bg-white text-black rounded-xl hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {respondingToId === inv.id ? 'Working...' : 'Accept'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NOTE: the list of invitations this workspace SENT, with their
          status and history, lives on the staff-only Invitations page
          (/dashboard/invitations). It is deliberately not repeated here -
          this page is about acting on an invitation, not reporting on them. */}

      {/* SECTION 0: MY TEAMS - teams you belong to, across every
            workspace, so a team you were added to is always visible
            regardless of which workspace is currently active. */}
      {myTeams.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>My Teams</span>
              <span className="text-[10px] bg-white/10 text-zinc-300 font-bold px-2 py-0.5 rounded-full">
                {myTeams.length}
              </span>
            </h2>
            <span className="text-[10px] text-zinc-500">Teams you're part of, across every workspace</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {myTeams.map((t) => (
              <motion.div
                key={t.id}
                whileHover={{ y: -2 }}
                onClick={() => handleOpenTeamModal(t)}
                className="bg-zinc-950 border border-white/10 hover:border-white/25 p-5 rounded-2xl space-y-3 cursor-pointer transition-all shadow-lg group relative"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-white group-hover:text-indigo-400 transition-colors flex items-center gap-2">
                    {t.name}
                  </h3>
                  <span
                    className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${
                      t.team_role === 'leader'
                        ? 'bg-amber-500/15 border border-amber-500/30 text-amber-400'
                        : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
                    }`}
                  >
                    {t.team_role === 'leader' ? 'Leader' : 'Member'}
                  </span>
                </div>

                <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                  {t.description || 'Dedicated workspace squad for collaborative tasks.'}
                </p>

                <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-white/5">
                  <span className="truncate">{t.workspace_name}</span>
                  <span className="text-zinc-400 group-hover:text-white flex items-center gap-1 font-semibold transition-colors">
                    {t.member_count} {t.member_count === 1 ? 'Member' : 'Members'}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 1: DEPARTMENT TEAMS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <span>Department Teams</span>
            <span className="text-[10px] bg-white/10 text-zinc-300 font-bold px-2 py-0.5 rounded-full">
              {teams.length}
            </span>
          </h2>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-zinc-900/40 rounded-2xl animate-pulse border border-white/5" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <div className="p-8 border border-dashed border-white/10 rounded-2xl text-center space-y-3 bg-zinc-950/50">
            <Users className="w-8 h-8 text-zinc-600 mx-auto" />
            <h3 className="text-sm font-semibold text-white">No department teams yet</h3>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto">
              Create teams like Engineering, Design, or Marketing to organize projects and delegate assignments.
            </p>
            {canManage && (
              <button
                onClick={() => setIsCreateTeamOpen(true)}
                className="mt-2 text-xs font-semibold bg-white text-black px-4 py-2 rounded-xl hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                + Create First Team
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {teams.map((t, idx) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: idx * 0.05, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -4, scale: 1.015, borderColor: 'rgba(255, 255, 255, 0.25)' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleOpenTeamModal(t)}
                className="bg-zinc-950 border border-white/10 p-5 rounded-2xl space-y-3 cursor-pointer transition-all shadow-lg group relative"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-white group-hover:text-indigo-400 transition-colors flex items-center gap-2">
                    {t.name}
                  </h3>
                  <span className="text-[10px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-semibold px-2.5 py-0.5 rounded-full">
                    {t.member_count} {t.member_count === 1 ? 'Member' : 'Members'}
                  </span>
                </div>

                <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                  {t.description || 'Dedicated workspace squad for collaborative tasks.'}
                </p>

                <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-500 border-t border-white/5">
                  <span>Created {new Date(t.created_at).toLocaleDateString()}</span>
                  <span className="text-zinc-400 group-hover:text-white flex items-center gap-1 font-semibold transition-colors">
                    Manage Squad <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 2: WORKSPACE COLLABORATORS TABLE */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <span>Workspace Collaborators</span>
            <span className="text-[10px] bg-white/10 text-zinc-300 font-bold px-2 py-0.5 rounded-full">
              {members.length}
            </span>
          </h2>

          {/* Member Search Bar */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchMember}
              onChange={(e) => setSearchMember(e.target.value)}
              placeholder="Search members..."
              className="w-full bg-zinc-900 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
            />
          </div>
        </div>

        <div className="bg-zinc-950 border border-white/10 rounded-2xl overflow-x-auto shadow-xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 border-b border-white/10 text-zinc-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-4">User</th>
                <th className="p-4">Email</th>
                <th className="p-4">Workspace Role</th>
                <th className="p-4">Joined Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500">
                    No collaborators found matching your search.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((m) => {
                  const isOwner = m.workspace_role === 'owner';
                  return (
                    <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 flex items-center gap-3 font-semibold text-white">
                        <Avatar
                          person={m}
                          roleKey="global_role"
                          alt={m.name}
                          className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span>{m.name}</span>
                            {isOwner && <Crown className="w-3 h-3 text-amber-400" title="Workspace Owner" />}
                          </div>
                          <span className="text-[10px] text-zinc-500 capitalize">{m.global_role || 'member'}</span>
                        </div>
                      </td>
                      <td className="p-4 text-zinc-400">{m.email}</td>
                      <td className="p-4">
                        <span
                          className={`capitalize px-2.5 py-0.5 rounded-full font-semibold text-[10px] border ${
                            isOwner
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              : m.workspace_role === 'admin'
                              ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                              : 'bg-white/10 border-white/10 text-zinc-300'
                          }`}
                        >
                          {m.workspace_role}
                        </span>
                      </td>
                      <td className="p-4 text-zinc-500">
                        {new Date(m.joined_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MODAL 1: CREATE TEAM MODAL */}
      {/* ==================================================================== */}
      {/* These modals are rendered through a portal into <body>.
          DashboardLayout animates a `filter` on the page wrapper, and any
          non-`none` filter turns that wrapper into the containing block for
          `position: fixed`. In-tree, the modal would therefore be positioned
          against the tall page box instead of the viewport - the backdrop
          would not cover the sidebar/header and the box would sit off-centre.

          The whole <AnimatePresence> is portalled, not a portal inside it:
          framer filters AnimatePresence's children with `isValidElement`, and
          React's Children.toArray() does not treat a portal as a valid
          element - so a portalled child would be silently dropped and the
          modal would never open. */}
      {createPortal(
        <AnimatePresence>
        {isCreateTeamOpen && (
          <div className="fixed inset-0 z-[100] overflow-hidden bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-zinc-950 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  Create New Team
                </h3>
                <button
                  onClick={() => setIsCreateTeamOpen(false)}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-900 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateTeam} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Team Name</label>
                  <input
                    type="text"
                    required
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. Frontend Engineering, Product Design"
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Description (Optional)</label>
                  <textarea
                    rows={3}
                    value={teamDesc}
                    onChange={(e) => setTeamDesc(e.target.value)}
                    placeholder="What does this department squad focus on?"
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
                  />
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateTeamOpen(false)}
                    className="px-4 py-2 text-xs text-zinc-400 hover:text-white rounded-xl border border-white/10 hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingTeam || !teamName.trim()}
                    className="px-5 py-2 text-xs font-bold bg-white text-black rounded-xl hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer shadow-md"
                  >
                    {submittingTeam ? 'Creating...' : 'Create Team'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
        </AnimatePresence>,
        document.body
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: INVITE MEMBER MODAL */}
      {/* ==================================================================== */}
      {createPortal(
        <AnimatePresence>
        {isInviteMemberOpen && (
          <div className="fixed inset-0 z-[100] overflow-hidden bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-zinc-950 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-indigo-400" />
                  Invite Collaborator
                </h3>
                <button
                  onClick={() => {
                    setIsInviteMemberOpen(false);
                    setInviteMsg(null);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-900 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {inviteMsg && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    inviteMsg.type === 'success'
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/15 border border-red-500/30 text-red-400'
                  }`}
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{inviteMsg.text}</span>
                </div>
              )}

              <form onSubmit={handleInviteMember} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Collaborator Email</label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@suprema.io"
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
                  />
                  <p className="text-[10px] text-zinc-500">
                    The user must have an existing account on the Suprema platform.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Workspace Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="member">Member (Can create & manage tasks)</option>
                    <option value="admin">Admin (Can manage projects, teams & settings)</option>
                    <option value="viewer">Viewer (Read-only access)</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsInviteMemberOpen(false);
                      setInviteMsg(null);
                    }}
                    className="px-4 py-2 text-xs text-zinc-400 hover:text-white rounded-xl border border-white/10 hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingInvite || !inviteEmail.trim()}
                    className="px-5 py-2 text-xs font-bold bg-white text-black rounded-xl hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer shadow-md"
                  >
                    {submittingInvite ? 'Inviting...' : 'Send Invitation'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
        </AnimatePresence>,
        document.body
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: TEAM DETAILS & SQUAD MANAGEMENT MODAL */}
      {/* ==================================================================== */}
      {createPortal(
        <AnimatePresence>
        {selectedTeam && (
          <div className="fixed inset-0 z-[100] overflow-hidden bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-xl bg-zinc-950 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-400" />
                    {selectedTeam.name}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    {selectedTeam.description || 'No description provided.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {canManageThisTeam && (
                    <button
                      onClick={() => handleDeleteTeam(selectedTeam.id)}
                      className="p-1.5 text-zinc-500 hover:text-red-400 rounded-xl hover:bg-red-500/10 transition-colors cursor-pointer"
                      title="Delete Team"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedTeam(null)}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Add Member To Team Form */}
              {canManageThisTeam && (
                <form onSubmit={handleAssignUserToTeam} className="p-4 bg-zinc-900/60 border border-white/10 rounded-2xl space-y-3">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-zinc-400" />
                    Add Workspace Member to Squad
                  </h4>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={assignUserId}
                      onChange={(e) => setAssignUserId(e.target.value)}
                      className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                    >
                      <option value="">Select a member...</option>
                      {members
                        .filter(m => !teamMembers.some(tm => tm.id === m.id))
                        .map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                        ))}
                    </select>

                    <select
                      value={assignRole}
                      onChange={(e) => setAssignRole(e.target.value)}
                      className="w-28 bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none cursor-pointer"
                    >
                      <option value="member">Member</option>
                      <option value="leader">Leader</option>
                    </select>

                    <button
                      type="submit"
                      disabled={submittingAssign || !assignUserId}
                      className="bg-white text-black font-semibold text-xs px-4 py-2 rounded-xl hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {submittingAssign ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </form>
              )}

              {/* Team Roster List */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Squad Roster</span>
                  <span className="text-zinc-500">{teamMembers.length} Members</span>
                </h4>

                {loadingTeamMembers ? (
                  <p className="text-xs text-zinc-500 py-4 text-center">Loading squad members...</p>
                ) : teamMembers.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4 text-center border border-dashed border-white/5 rounded-2xl">
                    No members assigned to this squad yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {teamMembers.map((tm) => (
                      <div
                        key={tm.id}
                        className="flex items-center justify-between p-3 bg-zinc-900/40 border border-white/5 rounded-xl text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar
                            person={tm}
                            roleKey="global_role"
                            alt={tm.name}
                            className="w-7 h-7 rounded-full bg-zinc-800"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">{tm.name}</span>
                              <span
                                className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                  tm.role === 'leader'
                                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                    : 'bg-white/10 text-zinc-300'
                                }`}
                              >
                                {tm.role}
                              </span>
                            </div>
                            <span className="text-[10px] text-zinc-500">{tm.email}</span>
                          </div>
                        </div>

                        {canManageThisTeam && (
                          <button
                            onClick={() => handleRemoveTeamMember(tm.id)}
                            className="text-zinc-500 hover:text-red-400 p-1.5 transition-colors cursor-pointer"
                            title="Remove from squad"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
