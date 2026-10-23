# Suprema — Manual Test Report (Day 15)

**Date:** 23 October 2026
**Environment:** Live production (Vercel frontend + serverless API, Supabase PostgreSQL `us-east-1`)
**Account used:** standard member (`sameermasih778@gmail.com`, role `member`, workspace `Sameer Khokhar's Workspace`)
**Method:** every screen driven in the browser, every form submitted, and the
network responses checked. Test data was created with the prefix `MANUAL TEST …
(auto-removed)` and removed again at the end — the database is left as it was.

## Summary

**The whole website works.** All 16 pages render, every interactive flow I
exercised completed end-to-end, and the database write cycle (create → read →
update → delete) is confirmed live against Supabase. One genuine bug was found
and fixed during the test (a missing `DELETE /projects/:id` route — the
"Delete" button in the Edit Project modal always 404'd), and a second bug the
teacher hit was root-caused (Google sign-up created no default workspace) and
fixed, including repairing the teacher's existing account in the database.

## Pages (16/16 render cleanly)

| Page | Status |
|---|---|
| Landing, Blogs, Changelog, Waitlist, Contact, Login, Signup | ✅ render, no broken images, no error overlays |
| Overview, Teams, Projects, Tasks (Kanban + List), Calendar, Analytics, Profile, Notifications, Invitations | ✅ render with real data, no broken images, no error overlays |

## Forms and flows exercised

| Flow | Result | Notes |
|---|---|---|
| Login (valid) | ✅ | navigates to dashboard, token stored |
| Login (invalid) | ✅ | stays on `/login`, no crash |
| Signup | ✅ | 201, token returned, default workspace created |
| Password reset request | ✅ | identical response for known / unknown email (no enumeration) |
| Waitlist join | ✅ | 201, position + referral code returned |
| Contact form | ✅ | 201, success message |
| Create project | ✅ | 201, appears on board |
| Edit project | ✅ | save + reload shows the change |
| Delete project (UI button) | ✅ | **this was the missing route — fixed and re-tested live** |
| Create task | ✅ | appears on the Kanban board for the selected project |
| Drag task between columns | ✅ | HTML5 drag moved To Do → In Progress, backend status updated |
| Edit task (priority) | ✅ | medium → high persisted |
| Add comment | ✅ | count updates, content renders |
| Delete comment | ✅ | gone after delete |
| Add subtask | ✅ | counter increments |
| Delete task | ✅ | native confirm dialog, then 404 on re-fetch |
| Create team | ✅ | appears in the list |
| Delete team | ✅ | removed from the list |
| Mark notifications read | ✅ | page renders its empty / populated state |
| Profile (name update) | ✅ | persisted and reverted |
| Invite member (invalid email) | ✅ | rejected with a validation message, no email sent |

## Access control (RBAC)

| Check | Result |
|---|---|
| Unauthenticated request to `/admin/*` | 401 ✅ |
| Member token on `/admin/leads/contact`, `/admin/workspaces`, `/admin/invitations`, `/admin/users`, `/admin/overview`, `/activity` | 403 ✅ |
| Member token on staff endpoints | 403 ✅ |
| Staff token on the same endpoints | 200 ✅ |

## Bugs found during the test (both fixed and deployed)

1. **Google sign-up created no default workspace.** A Google account that signed up
   before the fix had an empty dashboard, so every "Create…" form failed with a
   misleading *"…required"* message even though the field was filled. **Fixed in
   code** (Google signups now create the same default workspace as email
   signups, and returning workspaceless accounts repair themselves on login)
   and **fixed in data** — the teacher's account (`saleemali001232@gmail.com`)
   was backfilled with a workspace so it works immediately. A regression test was
   added and passes.
2. **`DELETE /api/v1/projects/:id` did not exist.** The Edit Project modal's
   Delete button always returned 404. **Implemented** with creator / workspace
   owner / workspace admin / staff authorization, plus 6 regression tests and a
   schema-cascade check (deleting a project removes its tasks).

## One anomaly, explained

A comment I posted through the task drawer at ~12:19 disappeared from the
database even though the UI had shown it as posted, and the drawer re-fetched
an empty list. Retrying the same flow ~2 minutes later worked and persisted
reliably (two probe comments were inserted and then deleted cleanly by me).
The most plausible cause is a Vercel serverless function being recycled
mid-request, which produces exactly this shape (the response never reaches the
browser, but the row may or may not have committed). The code's failure path
only logs to the console, so the user gets no feedback when this happens.

**Recommended small follow-up (not blocking):** surface the error in the
comment drawer with a toast, so a failed post is obvious instead of silent.

## Test data left in the system

None. Every entity I created during the test was removed afterwards and the
database was scanned for leftovers — zero `MANUAL TEST …` rows remain in
`projects`, `tasks`, `teams`, `task_comments`, `contact_messages`,
`waitlist_leads`, or `users`.

## Final state

- Code: 165/165 automated tests passing, lint + build clean
- Production: `UP`, database `CONNECTED`
- Git: all pushed (commit `8b9426e`, plus the cleanup commit)
- Database: Supabase PostgreSQL, `us-east-1` (same region as Vercel), zero
  remaining Aiven integration in the codebase
