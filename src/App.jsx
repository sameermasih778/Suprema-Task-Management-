import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/toast/ToastProvider';
import SmoothScroll from './components/SmoothScroll';
import { scrollToTop } from './lib/smoothScroll';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import MemberRoute from './components/MemberRoute';
import ErrorBoundary from './components/ErrorBoundary';

import Navbar from './components/Navbar';
import AdminNavbar from './components/AdminNavbar';
import Footer from './components/Footer';

// Public Marketing Pages
import Home from './pages/Home';
import Contact from './pages/Contact';
import BlogPage from './pages/BlogPage';
import BlogPost from './pages/BlogPost';
import ChangelogPage from './pages/ChangelogPage';
import WaitlistPage from './pages/WaitlistPage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import NotFoundPage from './pages/NotFoundPage';
import LoginPage from './pages/LoginPage';
import AdminLoginPage from './pages/AdminLoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfilePage from './pages/ProfilePage';

// Authenticated Dashboard Pages
import DashboardLayout from './components/dashboard/DashboardLayout';
import DashboardOverview from './pages/DashboardOverview';
import ProjectsPage from './pages/ProjectsPage';
import TasksPage from './pages/TasksPage';
import TeamsPage from './pages/TeamsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AdminLeadsPage from './pages/AdminLeadsPage';
import AdminChangelogPage from './pages/AdminChangelogPage';
import AdminBlogPage from './pages/AdminBlogPage';
import AdminOverviewPage from './pages/AdminOverviewPage';
import ActivityPage from './pages/ActivityPage';
import InvitationsPage from './pages/InvitationsPage';
import WorkspacesPage from './pages/WorkspacesPage';
import CalendarPage from './pages/CalendarPage';
import AnalyticsPage from './pages/AnalyticsPage';

/**
 * Scrolls to the top whenever the route changes.
 *
 * This is deliberately keyed on the pathname rather than hooked to the page
 * transition's exit animation. With `AnimatePresence mode="wait"` the outgoing
 * page stays mounted until its exit finishes, so resetting from inside the
 * incoming page would leave the new page scrolled to wherever the previous one
 * was if the animation were ever interrupted. Resetting here is deterministic.
 */
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    scrollToTop({ immediate: true });
  }, [pathname]);

  return null;
}

function MainLayout() {
  const location = useLocation();
  const { user } = useAuth();
  
  const isDashboardRoute = location.pathname.startsWith('/dashboard');
  const isAdminLoginRoute = location.pathname.startsWith('/admin-login') || location.pathname.startsWith('/staff-portal');

  // Navbar Rendering Rules:
  // 1. On Admin Login page (/admin-login, /staff-portal): render <AdminNavbar />
  // 2. On /dashboard: REMOVE navbar completely (for all users: admin, developer, and simple user)
  // 3. On all other public pages: render <Navbar />
  const renderNavbar = () => {
    if (isAdminLoginRoute) {
      return <AdminNavbar />;
    }
    if (isDashboardRoute) {
      return null;
    }
    return <Navbar />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-dark-1 text-white selection:bg-white/20 selection:text-white">
      {renderNavbar()}
      {!isDashboardRoute && !isAdminLoginRoute && <SmoothScroll />}
      <ErrorBoundary>
        <div className="flex-grow flex flex-col">
          <Routes>
            {/* Public Pages */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin-login" element={<AdminLoginPage />} />
            <Route path="/staff-portal" element={<AdminLoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/blogs" element={<BlogPage />} />
            <Route path="/blog" element={<BlogPage />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/blogs/:slug" element={<BlogPost />} />
            <Route path="/changelog" element={<ChangelogPage />} />
            <Route path="/waitlist" element={<WaitlistPage />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />

            {/* Catch-all: any URL that matches no real page renders the 404 screen
                (inside the normal Navbar + Footer). Also serves the footer's /404 link. */}
            <Route path="*" element={<NotFoundPage />} />

            {/* Protected Dashboard Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<DashboardLayout />}>
                <Route index element={<DashboardOverview />} />
                {/* Profile is member-only: staff use a fixed role emblem */}
                <Route element={<MemberRoute />}>
                  <Route path="profile" element={<ProfilePage />} />
                </Route>
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="teams" element={<TeamsPage />} />
                <Route element={<AdminRoute />}>
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="leads" element={<AdminLeadsPage />} />
                  <Route path="changelog-admin" element={<AdminChangelogPage />} />
                  <Route path="blog-admin" element={<AdminBlogPage />} />
                  <Route path="platform-overview" element={<AdminOverviewPage />} />
                  {/* Activity feed is a staff-only audit trail; the API enforces
                      this, so the route guard gives members a clear message
                      instead of an empty shell that logs a 403. */}
                  <Route path="activity" element={<ActivityPage />} />
                  {/* Every workspace invitation and how it was answered. */}
                  <Route path="invitations" element={<InvitationsPage />} />
                </Route>
                {/* Workspace administration is narrower than the rest of the
                    admin area: creating, freezing and deleting a whole tenant
                    is a platform-admin action, not a developer one. */}
                <Route element={<AdminRoute roles={['super_admin', 'admin']} />}>
                  <Route path="workspaces" element={<WorkspacesPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </div>
      </ErrorBoundary>
      {!isDashboardRoute && !isAdminLoginRoute && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    // ToastProvider sits outside AuthProvider and Router so a toast can be
    // raised from anywhere - including auth failures and the 404 page.
    <ToastProvider>
      <AuthProvider>
        <Router>
          <ScrollToTop />
          <MainLayout />
        </Router>
      </AuthProvider>
    </ToastProvider>
  );
}
