# Suprema — The Complete Guide

One guide for everyone who uses or builds Suprema.

Suprema is a team task-management platform. It answers one question: **what work
exists, who owns it, and where does it stand.** This single guide covers
everyone — new users, members, administrators and developers.

| You are | Start at |
| --- | --- |
| New / non-technical | Part 1 |
| A member or viewer | Part 2 |
| An administrator | Part 3 |
| A developer | Part 4 |
| Stuck right now | Part 5, FAQ |

Deeper guides for each area: [User](USER_GUIDE.md) · [Admin](ADMIN_GUIDE.md) ·
[Developer](DEVELOPER_GUIDE.md) · [Video script](VIDEO_SCRIPT.md).

**The live system**

| Service | Address |
| --- | --- |
| Frontend | `https://superma-task-management.vercel.app` |
| API | `https://superma-task-management-37zl.vercel.app/api/v1` |
| Health check | `https://superma-task-management-37zl.vercel.app/api/v1/health` |

> Before any demonstration, open the health check. It must say
> `"database":"CONNECTED"`. The database sleeps when idle — if it is asleep,
> every login fails until it is powered on. See Part 5.3.

---

## The basics

Suprema is built from a few simple parts:

| Part | What it is | Example |
| --- | --- | --- |
| Workspace | A team's sealed space | "Marketing" |
| Project | A group of related work | "Q1 Website Redesign" |
| Task | One piece of work | "Checkout fails on Safari" |
| Team | A named group of people | "Content Writers" |
| Stage | Where a task is now | To Do → In Progress → In Review → Done |
| Priority | How urgent it is | Urgent / High / Medium / Low |

**Three doors — on purpose:**

| Address | Who it is for |
| --- | --- |
| `/` | Public site — pricing, blogs, changelog, contact, waitlist |
| `/login` | Members and viewers |
| `/admin-login` | Staff (also `/staff-portal`) |

**Two permission systems** (the usual source of confusion):

- **Platform role** — who you are everywhere: `super_admin`, `admin`,
  `developer`, `member`, `viewer`.
  - `super_admin`, `admin`, `developer` are **staff**: they manage users, roles,
    passwords and broadcasts. Only a `super_admin` can permanently delete a user.
  - `member` does full project and task work in their workspaces.
  - `viewer` can read and comment, but is not a task owner.
- **Workspace role** — your permission inside one workspace: `owner`, `admin`,
  `member`, `guest`.

They are independent. If you "cannot do something", it is almost always one of
these two.

---

# Part 1 — Getting started

## 1.1 Create an account

1. Go to the site and click **Sign In → Create account**.
2. Enter your **name**, **email** and a **password**.
3. Suprema emails a **6-digit code** (valid **10 minutes**). Enter it. Done.

No code? Check spam, wait a minute, then request a new one.

**Or use Google.** Click **Continue with Google** and pick your account. You are
created as a **member**. If your email already exists, your role does not change.
Google can **never** create or promote staff.

## 1.2 Sign in, sign out, reset a password

| Task | Where |
| --- | --- |
| Members and viewers sign in | `/login` |
| Staff sign in | `/admin-login` |
| Sign out | **Sign Out** in the top bar |

**Forgot your password?** Fix it yourself — no administrator needed:

1. Click **Forgot your password?**
2. Enter your email and click **Send reset link**.
3. Open the email and click **Choose a new password**.
4. Set a new one and sign in.

The link works **once** and expires after **30 minutes**. An unknown email gets
the same message, so nobody can discover which accounts exist.

## 1.3 The dashboard at a glance

| Sidebar | What it does |
| --- | --- |
| Overview | Your task queue and the projects you contribute to |
| Projects | Every project and its progress |
| Tasks Board | All tasks — Kanban or List |
| Calendar | Tasks plotted on their due dates |
| Analytics | Completion rate, hours, overdue work, workload |
| Teams | Teams and their members |
| Activity Feed | A timestamped log of what happened |
| My Profile | Name, avatar, password (members and viewers) |
| User Management | Staff only — see Part 3 |

Switch workspaces from the name at the top of the sidebar. Everything you see
belongs to the workspace you select.

## 1.4 Five habits that save time

1. Start with **Calendar**, then open the **board**.
2. **Filter first.** "Mine + Overdue" answers "what do I do today?"
3. **Ctrl + K** jumps to anything.
4. Write task titles as outcomes, not activities.
5. Always set a **deadline**.

---

# Part 2 — Getting work done (members and viewers)

More detail lives in the [User Guide](USER_GUIDE.md).

## 2.1 Projects

**Create:** Projects → **New Project** → name, short description, status.

| Status | Meaning |
| --- | --- |
| Planning | Still being discussed |
| Active | Work is happening now |
| On hold | Paused deliberately |
| Completed | Finished |
| Archived | Closed and kept for the record |

Use one project per outcome — "Q1 Website Redesign", not "Marketing".

## 2.2 Tasks

**Create:** Tasks Board → **New Task**. Give each task a **title**, an
**assignee**, a **priority**, a **deadline** (strongly recommended) and,
optionally, a **project**.

**Stages** — drag the card, or use the task drawer:

```
To Do → In Progress → In Review → Done
```

**Priorities:** Urgent (blocking someone, or due now) · High (this week) ·
Medium (default) · Low (nice to have).

**Two views:**

- **Kanban** — columns per stage. Best for seeing flow and dragging cards.
- **List** — a table with counts and inline controls. Best for scanning and bulk
  edits.

**Filters:** assignee, deadline (overdue / today / this week / none), priority
and text search. Filters combine; **Reset** clears them all.

**The task drawer** (click any task): **Subtasks**, **Comments** and
**Attachments**. You can change status, priority, assignee and deadline right
there.

**Time tracking:** if a task has an estimate, log time with **+0.5h / +1h /
+2h** or an exact value. It warns when you go over estimate. Every change is
recorded in the activity log.

## 2.3 Calendar

`/dashboard/calendar` — a month grid with tasks on their due dates. Today is
highlighted, priority badges add colour, and overdue work stands out. Check it
each Monday: whatever is red comes first.

## 2.4 Analytics

`/dashboard/analytics` — completion rate, hours logged vs estimated, work in
progress, and overdue tasks. The **per-member workload table** shows who is
overloaded or underused.

## 2.5 Teams

`/dashboard/teams` lists teams and their members. Staff and workspace admins can
manage any team; members can manage the teams they created.

## 2.6 Activity Feed

A timestamped record of what happened — tasks, status changes, comments,
membership changes. It answers "when did this change, and who changed it?".

## 2.7 Find anything (Ctrl + K)

Press **Ctrl + K** (**⌘ + K** on a Mac) anywhere in the dashboard to open Global
Search. Type to search projects, tasks and teams, then use the arrow keys and
Enter to jump straight to a result.

## 2.8 Notifications and your profile

The **bell** shows assignments, mentions and announcements — mark them read
individually or all at once. **My Profile** lets you change your name, upload an
avatar (initials are used if you do not), change your password, and see your
workspaces and roles.

---

# Part 3 — Running the platform (administrators and staff)

For the `super_admin`, `admin` and `developer` roles. Full detail in the
[Admin Guide](ADMIN_GUIDE.md).

## 3.1 Signing in as staff

Staff use a **separate door**: `/admin-login` (also `/staff-portal`). It has
**no Google sign-in**, so a staff account can never be created, promoted or
authenticated through a third party. Staff roles are assigned by another
administrator — there is no self-signup.

## 3.2 What changes for staff

| Difference | Detail |
| --- | --- |
| User Management appears | Replaces My Profile |
| Activity Feed | Gets its own page, `/dashboard/activity` |
| Overview | Becomes a staff view: system health, directory, audit trail |
| Teams | Staff can manage any team |
| Admin API | User, role, password, status and broadcast endpoints unlock |

| Capability | super_admin | admin | developer |
| --- | --- | --- | --- |
| View users, change roles, reset passwords, suspend, broadcast | Yes | Yes | Yes |
| **Permanently delete a user** | **Yes** | No | No |

Deletion is irreversible — prefer **Suspend**.

## 3.3 The staff overview

`/dashboard` for staff shows **System health** (a live check of the API and its
database), the **user directory** and the **audit trail**. If health reports the
database as disconnected, no user action fixes it — see Part 5.3.

## 3.4 User management (`/dashboard/users`)

- **Find** an account by name or email; filter by role and status.
- **Change role** — you cannot grant a role stronger than your own, and you
  cannot change your own role (self-lockout protection).
- **Reset password** — set one (8–72 characters) or generate one (shown once).
  Every reset is written to the audit log.
- **Suspend** — blocks every sign-in method including Google, keeps all data and
  is reversible. Use this instead of deletion.

## 3.5 Broadcast

User Management → **Broadcast** sends one message to the whole workspace. Use it
for maintenance windows and releases, and keep it rare.

## 3.6 Lead Inbox (`/dashboard/leads`)

Contact-form inquiries and Waitlist signups land here.

- **Contact tab:** move each through **Unread → Read → Replied**.
- **Waitlist tab:** real queue order, each with a referral code; status is
  **Pending / Invited / Active**.
- **Export CSV** opens cleanly in Excel (commas, quotes and accents escaped).

## 3.7 Changelog Manager (`/dashboard/changelog-admin`)

Publishes the public **Changelog**. It writes live and shows newest first.

- **Version tag** must be unique (e.g. `v1.4.0`).
- **Release date** is required — it sets the order.
- Set the badge, colour, title, description and bullets.

Deleting removes the entry from the public page immediately.

## 3.8 Your real duties

**Rotate any secret that leaks:**

| Secret | Where | If it leaks |
| --- | --- | --- |
| Database password | Vercel + `server/.env` | Reset at the provider, update Vercel, redeploy |
| `JWT_SECRET` | Vercel + `server/.env` | Regenerate and redeploy — **everyone is signed out** (expected) |
| Cloudinary API secret | Vercel + `server/.env` | Regenerate in Cloudinary |
| SMTP app password | Vercel + `server/.env` | Revoke in Google Account → App passwords |

Never paste a secret into chat, a ticket or a commit. If it has ever been in
public git history, rotating it is mandatory.

**Keep the database awake.** It sleeps when idle — check the health endpoint
(Part 5.3) before any demonstration.

---

# Part 4 — Building and deploying (developers)

Full reference in the [Developer Guide](DEVELOPER_GUIDE.md).

## 4.1 The stack

| Layer | Technology |
| --- | --- |
| Frontend | React + Vite (`src/`) |
| Backend | Node.js + Express (`server/`) |
| Database | Supabase (PostgreSQL 17, free tier) |
| Auth | Password (bcrypt) + Google OAuth + email OTP + JWT |
| Email | Nodemailer over SMTP |
| Media | Cloudinary |
| Hosting | Vercel (frontend and backend) |
| Tests | Node test runner, isolated test database |

## 4.2 Run it locally

Requires modern Node.js LTS.

- **Backend** (`server/`): copy `server/.env.example` to `server/.env` and fill
  it in. SQL files in `server/db/` build the schema.
- **Frontend** (`src/`): `.env` with `VITE_API_URL=http://localhost:5000/api/v1`.
- **Both at once:** `npm run dev` from the project root.

## 4.3 Environment variables (`server/.env`)

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | yes | `5000` locally |
| `CLIENT_ORIGIN` | yes | Comma-separated CORS origins |
| `DATABASE_URL` | yes | Supabase PostgreSQL connection string (session pooler URI) |
| `DB_CONNECTION_LIMIT` | production | `5` - free tiers cap connections |
| `JWT_SECRET` | **yes** | Long random string; never the dev fallback |
| `JWT_EXPIRES_IN` | yes | e.g. `7d` |
| `SMTP_*` | optional | OTP email; unset = codes logged to console |
| `GOOGLE_CLIENT_ID` | optional | Enables Google sign-in |
| `FRONTEND_URL` | production | Reset links and CORS |

Frontend `.env`: `VITE_API_URL`.

## 4.4 Authentication rules (get these right)

- New accounts are **always created as `member`**. No self-service path reaches
  staff — not even Google.
- `authorizeRoles(...)` runs **per route on the server**. Hiding a button is
  never access control.
- Role order: `super_admin` > `admin` > `developer` > `member` > `viewer`.

## 4.5 Tests

`npm test` runs **112 tests across 7 suites** against an isolated `suprema_test`
database. SMTP is stubbed and rate limiting is skipped in tests. Never run the
suite against production data.

## 4.6 Security summary

Hardened response headers; one error handler that never leaks internals; rate
limiting on auth routes; all queries parameterised; no secrets in the repo.
Google refuses unverified emails, OTP codes expire, and reset links are
single-use with a 30-minute window.

## 4.7 Deploy (Vercel)

Backend and frontend are separate Vercel projects. Set every environment
variable in the project settings, redeploy, then verify with the health check
and a real login.

---

# Part 5 — Troubleshooting

## 5.1 Members

| Problem | What to do |
| --- | --- |
| "Something went wrong on our end" | Try again; if it persists the database may be asleep — tell an admin |
| Verification code never arrives | Check spam, wait a minute, request a new one |
| Google says "Access blocked" | Your email is not on the app's test-user list — ask an admin |
| A sidebar item is missing | It is role-based |
| I cannot edit a team | Only its owner, workspace admins and staff can |
| Blank page after clicking a link | Hard-refresh once (new deploy) |
| Sign-in says account suspended | An admin suspended it — contact them |

## 5.2 Staff

| Problem | Cause | Fix |
| --- | --- | --- |
| All logins fail, health DISCONNECTED | Database asleep | See 5.3 |
| Google "not configured" | `GOOGLE_CLIENT_ID` missing | Add it, redeploy |
| Cannot see User Management | Not staff | Sign in at `/admin-login` |
| Cannot delete a user | Only `super_admin` | Suspend instead |
| Reset password sent no email | SMTP not configured | Use the generated password |
| Cannot change my own role | Self-lockout protection | Ask another admin |

## 5.3 The database is asleep (the most common problem)

**Symptom:** every sign-in fails and the health endpoint says
`"database":"DISCONNECTED"`.
**Why:** the free tier powers off when idle. The data is completely safe.
**Fix:** open the provider console, power the service **on**, wait until it reads
`RUNNING` (one to two minutes), then check the health endpoint again. Users do
nothing — access returns on its own.
**Prevent:** check the health endpoint before every demonstration.

## 5.4 Escalation path (staff)

1. Check the **System health** panel.
2. Check the **Activity Feed** for a recent change that explains it.
3. If the database is down, power it on — the most common cause by far.
4. Otherwise capture the failing URL, the time and the exact message, then
   escalate to the developer who maintains the deployment.

---

# FAQ

**Is Google sign-in safe for admin accounts?**
Yes. Staff accounts cannot be created or authenticated through Google at all —
it always produces a `member`.

**I forgot my password — does an admin have to fix it?**
No. Use **Forgot your password?**; the link is single-use and expires after 30
minutes.

**Why does my sidebar differ from my colleague's?**
Items are role-based, and you may be viewing a different workspace.

**Is my data safe while the database sleeps?**
Yes. It is powered off, not deleted.

**Can I recover a permanently deleted user?**
No — deletion is irreversible. Use **Suspend** to preserve history.

**Why is my changelog entry not showing?**
Check its **release date**; a missing date sorts it to the bottom.

**How do I test without touching real users?**
Tests use an isolated `suprema_test` database. Never test against production.

---

# Glossary

| Term | Meaning |
| --- | --- |
| Workspace | A sealed team space with projects, tasks, teams and members |
| Workspace role | Your permission in one workspace: `owner`, `admin`, `member`, `guest` |
| Platform role | Who you are everywhere: `super_admin`, `admin`, `developer`, `member`, `viewer` |
| Project | A group of related work, with a status |
| Task | One piece of work: title, assignee, priority, deadline, stage |
| Stage | `To Do → In Progress → In Review → Done` |
| Kanban / List | Board view (by stage) / table view (scan and bulk edit) |
| OTP | One-time 6-digit code emailed to verify signup |
| JWT | The signed session token; rotating `JWT_SECRET` signs everyone out |
| Activity feed | The timestamped record of who changed what |
| Lead | A contact inquiry or waitlist signup |

---

# Quick reference

- **Frontend:** `https://superma-task-management.vercel.app`
- **API:** `https://superma-task-management-37zl.vercel.app/api/v1`
- **Health:** `.../api/v1/health` → must say `"database":"CONNECTED"`
- **Doors:** `/` public · `/login` members · `/admin-login` staff
- **Stages:** `To Do → In Progress → In Review → Done`
- **Priorities:** `Urgent · High · Medium · Low`
- **Search:** `Ctrl + K` / `⌘ + K`
- **Demo accounts:** seeded in the repo and test environment at `@suprema.io`.
  They may **not** exist in production — request working credentials before a
  demo, and change them before any public demonstration.

---

*This guide is maintained with the codebase. If behaviour changes, update this
document in the same change. Never write a real secret or password into these
files.*
