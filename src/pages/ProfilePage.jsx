import React, { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  User, Mail, Shield, Building2, Upload, Trash2, Image as ImageIcon,
  Loader2, ArrowLeft, ShieldCheck, RotateCcw, Lock
} from 'lucide-react';
import api from '../utils/api';
import { useToast } from '../components/toast/ToastContext';
import { useAuth } from '../context/AuthContext';
import { getAvatarUrl, canUploadAvatar, isStaffRole } from '../utils/avatar';

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Administrator',
  developer: 'Developer',
  member: 'Member',
  viewer: 'Viewer'
};

function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export default function ProfilePage() {
  const { user, activeWorkspace } = useAuth();
  const toast = useToast();

  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Editable profile fields (name + email). Synced from the auth context.
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  // Email-change verification flow (code sent to the new address).
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  // A stored path can outlive its file (cleared disk, migrated to cloud, or a
  // blocked cross-origin load). Track the failure so the tile falls back to
  // initials instead of rendering an empty circle.
  const [imageBroken, setImageBroken] = useState(false);

  // Keep the editable fields in sync with the signed-in user (including after
  // a profile refresh triggered by avatar upload or by this save).
  useEffect(() => {
    setProfileName(user?.name || '');
    setProfileEmail(user?.email || '');
  }, [user?.id, user?.name, user?.email]);

  // Object URLs must be revoked or the blob stays in memory for the session.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Staff accounts are shown a fixed role emblem and cannot upload a photo.
  const isStaff = isStaffRole(user?.role);
  const uploadsAllowed = canUploadAvatar(user?.role);

  const storedAvatar = isStaff ? null : user?.avatar_url || null;
  const displaySrc = preview || getAvatarUrl(user);

  // New picture selected or uploaded -> clear any previous load failure.
  useEffect(() => { setImageBroken(false); }, [displaySrc]);

  const handleFile = (file) => {
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      toast.error(`${file.name} is not a supported image. Use PNG, JPEG, GIF or WEBP.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 2MB.`);
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);

    const formData = new FormData();
    formData.append('avatar', selectedFile);

    try {
      // Content-Type is intentionally omitted so the browser sets the
      // multipart boundary itself (see utils/api.js).
      const res = await api.post('/auth/avatar', formData);

      // Update the session copy so the sidebar/header reflect the new picture
      // without needing a full re-login.
      const raw = localStorage.getItem('suprema_user');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.avatar_url = res.avatar_url;
          localStorage.setItem('suprema_user', JSON.stringify(parsed));
        } catch { /* session copy is advisory only */ }
      }

      setSelectedFile(null);
      setPreview(null);
      toast.success('Profile picture updated');
      // Re-fetch /auth/me so AuthContext state is authoritative.
      window.dispatchEvent(new Event('suprema:profile-updated'));
    } catch (err) {
      toast.error(err.message || 'Could not upload that image');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await api.delete('/auth/avatar');

      const raw = localStorage.getItem('suprema_user');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.avatar_url = null;
          localStorage.setItem('suprema_user', JSON.stringify(parsed));
        } catch { /* ignore */ }
      }

      setSelectedFile(null);
      setPreview(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      toast.success('Profile picture removed');
      window.dispatchEvent(new Event('suprema:profile-updated'));
    } catch (err) {
      toast.error(err.message || 'Could not remove the picture');
    } finally {
      setRemoving(false);
    }
  };

  const handleSaveName = async () => {
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      toast.error('Name cannot be empty.');
      return;
    }
    if (trimmedName === (user?.name || '')) {
      toast.info('Nothing to save.');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await api.put('/auth/me', { name: trimmedName });

      if (res.token) {
        localStorage.setItem('suprema_token', res.token);
        sessionStorage.setItem('suprema_token', res.token);
      }
      const raw = localStorage.getItem('suprema_user');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.name = res.user?.name ?? trimmedName;
          localStorage.setItem('suprema_user', JSON.stringify(parsed));
        } catch { /* advisory */ }
      }

      toast.success('Name updated');
      window.dispatchEvent(new Event('suprema:profile-updated'));
    } catch (err) {
      toast.error(err.data?.message || err.message || 'Could not update name');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRequestEmailChange = async () => {
    const trimmedEmail = profileEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      toast.error('Enter a valid email address.');
      return;
    }
    if (trimmedEmail === (user?.email || '').toLowerCase()) {
      toast.info('That is already your email.');
      return;
    }

    setSendingCode(true);
    try {
      const res = await api.post('/auth/me/email/request-change', { email: trimmedEmail });
      toast.success(res.message || 'Verification code sent');
      setEmailCode('');
      setEmailCodeSent(true);
    } catch (err) {
      toast.error(err.data?.message || err.message || 'Could not send verification code');
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyEmailChange = async () => {
    const trimmedEmail = profileEmail.trim().toLowerCase();
    const code = emailCode.trim();
    if (!code) {
      toast.error('Enter the verification code.');
      return;
    }

    setVerifyingEmail(true);
    try {
      const res = await api.post('/auth/me/email/verify-change', { email: trimmedEmail, otp: code });
      if (res.token) {
        localStorage.setItem('suprema_token', res.token);
        sessionStorage.setItem('suprema_token', res.token);
      }
      const raw = localStorage.getItem('suprema_user');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.email = res.user?.email ?? trimmedEmail;
          localStorage.setItem('suprema_user', JSON.stringify(parsed));
        } catch { /* advisory */ }
      }
      toast.success('Email updated');
      setEmailCode('');
      setEmailCodeSent(false);
      window.dispatchEvent(new Event('suprema:profile-updated'));
    } catch (err) {
      toast.error(err.data?.message || err.message || 'Verification failed');
    } finally {
      setVerifyingEmail(false);
    }
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  // "Remove picture" only makes sense for an actual upload: legacy local
  // paths or a Cloudinary URL. The placeholder badge has nothing to remove.
  const hasStoredUpload =
    !!storedAvatar &&
    (storedAvatar.startsWith('/uploads/avatars/') ||
      storedAvatar.includes('res.cloudinary.com/'));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white">
            <User className="h-6 w-6 text-indigo-400" />
            Profile Settings
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Your account details and profile picture.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>
      </div>

      {/* Guarded by MemberRoute for staff; the branch below is a safety net. */}
      <section className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div
              onDragOver={uploadsAllowed ? (e) => { e.preventDefault(); setDragging(true); } : undefined}
              onDragLeave={uploadsAllowed ? () => setDragging(false) : undefined}
              onDrop={uploadsAllowed ? handleDrop : undefined}
              className={`relative h-28 w-28 shrink-0 overflow-hidden rounded-full border-2 transition-colors ${
                dragging && uploadsAllowed ? 'border-indigo-400' : 'border-white/10'
              }`}
            >
              {/* The initials tile always sits BEHIND the picture. A picture
                  that fails to load (Google rate-limits its CDN, a file can
                  be deleted) can then never leave an empty or broken-image
                  circle - the initials show through instead. The alt text is
                  suppressed because a browser paints it over the layout
                  until the image resolves. */}
              <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-600 text-2xl font-black text-white">
                {initials(user?.name)}
              </span>

              {displaySrc && !imageBroken && (
                <img
                  src={displaySrc}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={() => setImageBroken(true)}
                />
              )}
              {selectedFile && (
                <span className="absolute inset-x-0 bottom-0 bg-black/80 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-indigo-300">
                  Unsaved
                </span>
              )}

              {isStaff && (
                <span className="absolute inset-x-0 bottom-0 bg-black/80 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-zinc-300">
                  {ROLE_LABELS[user?.role] || 'Staff'}
                </span>
              )}
            </div>

            {uploadsAllowed && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED.join(',')}
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Choose image
                </button>
              </>
            )}
          </div>

          {/* Details */}
          <dl className="min-w-0 flex-1 space-y-4">
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <User className="h-3 w-3" /> Full name
              </dt>
              <dd className="mt-1">
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white placeholder-zinc-500 focus:border-indigo-500/60 focus:outline-none transition-all"
                />
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <Mail className="h-3 w-3" /> Email
              </dt>
              <dd className="mt-1 space-y-2">
                <input
                  type="email"
                  value={profileEmail}
                  onChange={(e) => { setProfileEmail(e.target.value); setEmailCodeSent(false); setEmailCode(''); }}
                  maxLength={150}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-300 placeholder-zinc-500 focus:border-indigo-500/60 focus:outline-none transition-all"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRequestEmailChange}
                    disabled={sendingCode || emailCodeSent}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sendingCode && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {emailCodeSent ? 'Code sent' : 'Send verification code'}
                  </button>
                </div>
                {emailCodeSent && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value.replace(/\\D/g, '').slice(0, 6))}
                      placeholder="6-digit code"
                      className="w-32 rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-sm font-mono text-white placeholder-zinc-500 focus:border-indigo-500/60 focus:outline-none transition-all"
                    />
                    <button
                      onClick={handleVerifyEmailChange}
                      disabled={verifyingEmail || emailCode.length !== 6}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {verifyingEmail && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {verifyingEmail ? 'Verifying…' : 'Verify & update email'}
                    </button>
                  </div>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <div>
                <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <Shield className="h-3 w-3" /> Role
                </dt>
                <dd className="mt-0.5 text-sm text-zinc-300">
                  {ROLE_LABELS[user?.role] || user?.role || '—'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <Building2 className="h-3 w-3" /> Workspace
                </dt>
                <dd className="mt-0.5 truncate text-sm text-zinc-300">
                  {activeWorkspace?.name || '—'}
                </dd>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleSaveName}
                disabled={savingProfile}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingProfile && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {savingProfile ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </dl>
        </div>

        {/* Upload controls */}
        {/* Upload controls - members and viewers only */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-5">
          {isStaff ? (
            <p className="flex items-start gap-2 text-[11px] text-zinc-400">
              <Lock className="mt-px h-3.5 w-3.5 shrink-0 text-indigo-400" />
              <span>
                Staff accounts use a fixed role emblem so it is always clear which
                portal someone is in. Profile pictures are for member and viewer accounts.
              </span>
            </p>
          ) : (
            <>
          {selectedFile && (
            <>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {uploading ? 'Uploading...' : 'Save picture'}
              </button>
              <button
                onClick={() => {
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                  setSelectedFile(null);
                }}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Discard
              </button>
            </>
          )}

          {hasStoredUpload && !selectedFile && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {removing ? 'Removing...' : 'Remove picture'}
            </button>
          )}

          {!selectedFile && !hasStoredUpload && (
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Using a generated avatar. Drop an image above, or browse for one.
            </p>
          )}
            </>
          )}
        </div>

        {!isStaff && (
          <p className="mt-3 text-[10px] text-zinc-600">
            PNG, JPEG, GIF or WEBP · maximum 2MB. You can also drag an image onto the picture above.
          </p>
        )}
      </section>
    </div>
  );
}