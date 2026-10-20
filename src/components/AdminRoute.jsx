import React from 'react';
import { Navigate, Outlet, Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const STAFF_ROLES = ['super_admin', 'admin', 'developer'];

/**
 * Route guard for staff-only pages (e.g. /dashboard/users).
 * The backend already enforces RBAC via authorizeRoles - this guard exists
 * so a non-staff user who types the URL gets a clear message instead of a
 * broken page shell that renders empty before the API returns a 403.
 *
 * `roles` narrows the guard for pages that even staff may not open, such as
 * workspace administration (creating and deleting whole tenants).
 */
export default function AdminRoute({ roles = STAFF_ROLES }) {
  const { isAuthenticated, loading, user } = useAuth();

  const isStaff = roles.includes(user?.role);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm font-medium">Verifying staff access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={isStaff ? '/admin-login' : '/login'} replace />;
  }

  if (!isStaff) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center bg-zinc-950 border border-white/10 rounded-2xl p-10">
          <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight mb-2">Access Denied</h1>
          <p className="text-sm text-zinc-500 leading-relaxed mb-6">
            This area is restricted to administrators and developers.
            Your account role is <span className="font-semibold text-zinc-300 capitalize">{user?.role || 'guest'}</span>.          </p>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <Outlet />;
}