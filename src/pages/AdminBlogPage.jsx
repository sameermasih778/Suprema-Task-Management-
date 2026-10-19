import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen, Plus, Pencil, Trash2, Loader2, AlertCircle,
  CheckCircle2, RefreshCw, X, Search, Eye, EyeOff, Star
} from 'lucide-react';
import api from '../utils/api';
import { useToast } from '../components/toast/ToastContext';

/**
 * Blog CMS — editorial side of the public /blog page.
 *
 * Whatever is published here appears on the marketing site immediately because
 * the public BlogPage reads from the same `blogs` table via GET /api/v1/blogs.
 */

const CATEGORIES = ['Efficiency', 'Productivity', 'Collaboration', 'Task Management', 'Engineering', 'Design', 'Company'];
const STATUSES   = ['draft', 'published', 'archived'];

const EMPTY_FORM = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  category: 'Productivity',
  author_name: '',
  author_role: '',
  author_avatar: '',
  cover_image: '',
  tags: '',
  read_time: '',
  featured: false,
  status: 'draft',
};

const toSlug = (title) =>
  title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-600">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30';

const StatusBadge = ({ status }) => {
  const map = {
    published: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    draft:     'bg-amber-500/15  text-amber-400  border-amber-500/20',
    archived:  'bg-zinc-500/15  text-zinc-400   border-zinc-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${map[status] || map.draft}`}>
      {status}
    </span>
  );
};

export default function AdminBlogPage() {
  const { showToast } = useToast();
  const [blogs, setBlogs]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  /* modal */
  const [modalOpen, setModalOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null = new
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  /* delete */
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);

  /* ── fetch ── */
  const fetchBlogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/admin/blogs');
      setBlogs(data.blogs || []);
    } catch (err) {
      setError(err.message || 'Failed to load blog posts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBlogs(); }, [fetchBlogs]);

  /* ── modal helpers ── */
  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = async (blog) => {
    setEditTarget(blog);
    setFormError(null);
    setFieldErrors({});
    // Load full post for content field
    try {
      const data = await api.get(`/admin/blogs/${blog.id}`);
      const b = data.blog;
      setForm({
        title:        b.title       || '',
        slug:         b.slug        || '',
        excerpt:      b.excerpt     || '',
        content:      b.content     || '',
        category:     b.category    || 'Productivity',
        author_name:  b.author_name || '',
        author_role:  b.author_role || '',
        author_avatar: b.author_avatar || '',
        cover_image:  b.cover_image || '',
        tags:         Array.isArray(b.tags) ? b.tags.join(', ') : (b.tags || ''),
        read_time:    b.read_time   || '',
        featured:     !!b.featured,
        status:       b.status      || 'draft',
      });
    } catch {
      setForm({
        title: blog.title, slug: '', excerpt: '', content: '',
        category: blog.category || 'Productivity',
        author_name: blog.author_name || '', author_role: '',
        author_avatar: '', cover_image: '', tags: '',
        read_time: blog.read_time || '', featured: !!blog.featured,
        status: blog.status || 'draft',
      });
    }
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setFormError(null); setFieldErrors({}); };

  /* Auto-generate slug from title when creating */
  const handleTitleChange = (val) => {
    setForm((f) => ({
      ...f,
      title: val,
      ...(editTarget ? {} : { slug: toSlug(val) }),
    }));
  };

  const handleField = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  /* ── save ── */
  const handleSave = async () => {
    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const payload = {
      ...form,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    };

    try {
      if (editTarget) {
        await api.put(`/admin/blogs/${editTarget.id}`, payload);
        showToast('Blog post updated.', 'success');
      } else {
        await api.post('/admin/blogs', payload);
        showToast('Blog post created.', 'success');
      }
      closeModal();
      fetchBlogs();
    } catch (err) {
      if (err.errors) setFieldErrors(err.errors);
      setFormError(err.message || 'Save failed. Please check the fields.');
    } finally {
      setSaving(false);
    }
  };

  /* ── delete ── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/blogs/${deleteTarget.id}`);
      showToast('Blog post deleted.', 'success');
      setDeleteTarget(null);
      fetchBlogs();
    } catch (err) {
      showToast(err.message || 'Delete failed.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  /* ── filtered list ── */
  const filtered = blogs.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch = !q || b.title.toLowerCase().includes(q) || (b.author_name || '').toLowerCase().includes(q);
    const matchStatus = filterStatus === 'all' || b.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const counts = {
    all:       blogs.length,
    published: blogs.filter((b) => b.status === 'published').length,
    draft:     blogs.filter((b) => b.status === 'draft').length,
    archived:  blogs.filter((b) => b.status === 'archived').length,
  };

  const formatDate = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-indigo-400" />
            Blog CMS
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Published posts appear live on the public <span className="text-indigo-400">/blog</span> page immediately.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchBlogs} className="p-2 rounded-xl border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 transition cursor-pointer">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New Post
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'published', 'draft', 'archived'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold capitalize transition cursor-pointer border ${
              filterStatus === s
                ? 'bg-white text-black border-white'
                : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {s} <span className="opacity-60 ml-1">({counts[s]})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or author…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-sm text-white placeholder-zinc-600 outline-none focus:border-indigo-500/60"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin mr-3" /> Loading posts…
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-zinc-600">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search ? 'No posts match your search.' : 'No posts yet. Create your first blog post!'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((blog) => (
            <div
              key={blog.id}
              className="flex items-center gap-4 p-4 rounded-2xl border border-white/10 bg-zinc-900/60 hover:bg-zinc-900 transition group"
            >
              {/* Featured star */}
              <div className="w-8 flex-shrink-0 flex items-center justify-center">
                {blog.featured ? (
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-zinc-800 block" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white text-sm truncate max-w-[300px]">{blog.title}</span>
                  <StatusBadge status={blog.status} />
                  {blog.category && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {blog.category}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                  <span>by {blog.author_name || '—'}</span>
                  {blog.read_time && <span>· {blog.read_time}</span>}
                  <span>· {blog.status === 'published' ? `Published ${formatDate(blog.published_at)}` : `Updated ${formatDate(blog.updated_at)}`}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => openEdit(blog)}
                  title="Edit"
                  className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeleteTarget(blog)}
                  title="Delete"
                  className="p-2 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ────────── Edit / Create Modal ────────── */}
      {/* Portalled into <body>: the dashboard page wrapper animates a `filter`,
          which makes it the containing block for `position: fixed`. In-tree the
          overlay would be sized against the page box instead of the viewport. */}
      {modalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm py-8 px-4 overflow-y-auto">
          <div className="bg-zinc-950 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl my-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-base font-bold text-white">
                {editTarget ? 'Edit Blog Post' : 'New Blog Post'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {formError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {formError}
                </div>
              )}

              {/* Title */}
              <Field label="Title *" >
                <input
                  value={form.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="How to ship 10x faster with Suprema"
                  className={`${inputClass} ${fieldErrors.title ? 'border-red-500/60' : ''}`}
                />
                {fieldErrors.title && <span className="mt-1 block text-[11px] text-red-400">{fieldErrors.title}</span>}
              </Field>

              {/* Slug */}
              <Field label="Slug *" hint="URL-safe, lowercase, hyphens only. Auto-generated from title on create.">
                <input
                  value={form.slug}
                  onChange={(e) => handleField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="how-to-ship-10x-faster"
                  className={`${inputClass} ${fieldErrors.slug ? 'border-red-500/60' : ''}`}
                />
                {fieldErrors.slug && <span className="mt-1 block text-[11px] text-red-400">{fieldErrors.slug}</span>}
              </Field>

              {/* Excerpt */}
              <Field label="Excerpt *" hint="Short summary shown in listing cards.">
                <textarea
                  value={form.excerpt}
                  onChange={(e) => handleField('excerpt', e.target.value)}
                  rows={2}
                  placeholder="A short, compelling description of the post…"
                  className={`${inputClass} resize-y ${fieldErrors.excerpt ? 'border-red-500/60' : ''}`}
                />
                {fieldErrors.excerpt && <span className="mt-1 block text-[11px] text-red-400">{fieldErrors.excerpt}</span>}
              </Field>

              {/* Content */}
              <Field label="Content (Markdown) *" hint="Supports Markdown. This is the full article body.">
                <textarea
                  value={form.content}
                  onChange={(e) => handleField('content', e.target.value)}
                  rows={10}
                  placeholder={`## Introduction\n\nStart writing your article here…`}
                  className={`${inputClass} resize-y font-mono text-xs ${fieldErrors.content ? 'border-red-500/60' : ''}`}
                />
                {fieldErrors.content && <span className="mt-1 block text-[11px] text-red-400">{fieldErrors.content}</span>}
              </Field>

              {/* Row: Category + Status */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Category *">
                  <select
                    value={form.category}
                    onChange={(e) => handleField('category', e.target.value)}
                    className={`${inputClass} ${fieldErrors.category ? 'border-red-500/60' : ''}`}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={form.status}
                    onChange={(e) => handleField('status', e.target.value)}
                    className={inputClass}
                  >
                    {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </Field>
              </div>

              {/* Author */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Author Name *">
                  <input
                    value={form.author_name}
                    onChange={(e) => handleField('author_name', e.target.value)}
                    placeholder="Jane Smith"
                    className={`${inputClass} ${fieldErrors.author_name ? 'border-red-500/60' : ''}`}
                  />
                  {fieldErrors.author_name && <span className="mt-1 block text-[11px] text-red-400">{fieldErrors.author_name}</span>}
                </Field>
                <Field label="Author Role">
                  <input
                    value={form.author_role}
                    onChange={(e) => handleField('author_role', e.target.value)}
                    placeholder="Head of Engineering"
                    className={inputClass}
                  />
                </Field>
              </div>

              {/* Row: Read time + Tags */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Read Time" hint='e.g. "5 min read"'>
                  <input
                    value={form.read_time}
                    onChange={(e) => handleField('read_time', e.target.value)}
                    placeholder="5 min read"
                    className={inputClass}
                  />
                </Field>
                <Field label="Tags" hint="Comma-separated, e.g. productivity, teams">
                  <input
                    value={form.tags}
                    onChange={(e) => handleField('tags', e.target.value)}
                    placeholder="productivity, teams, tips"
                    className={inputClass}
                  />
                </Field>
              </div>

              {/* Cover image + Author avatar */}
              <Field label="Cover Image URL">
                <input
                  value={form.cover_image}
                  onChange={(e) => handleField('cover_image', e.target.value)}
                  placeholder="https://…"
                  className={inputClass}
                />
              </Field>

              {/* Featured toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <button
                  type="button"
                  onClick={() => handleField('featured', !form.featured)}
                  className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${form.featured ? 'bg-indigo-600' : 'bg-zinc-700'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.featured ? 'translate-x-5' : ''}`} />
                </button>
                <span className="text-sm text-zinc-300">Feature this post (shown in hero section)</span>
              </label>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={closeModal} className="px-4 py-2 rounded-xl text-sm text-zinc-400 hover:text-white border border-white/10 hover:bg-white/5 transition cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition disabled:opacity-50 cursor-pointer"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {editTarget ? 'Save Changes' : 'Publish Post'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ────────── Delete Confirm ────────── */}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="bg-zinc-950 border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2">Delete Post?</h3>
            <p className="text-sm text-zinc-400 mb-6">
              <span className="font-semibold text-white">"{deleteTarget.title}"</span> will be permanently removed. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-xl text-sm text-zinc-400 border border-white/10 hover:bg-white/5 transition cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition disabled:opacity-50 cursor-pointer"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
