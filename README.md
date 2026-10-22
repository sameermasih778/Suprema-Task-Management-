# Suprema

**A full-stack task & project management SaaS platform** — a React + Vite front end, a Node.js/Express REST API, and a Supabase (PostgreSQL) database, deployed to the cloud.

Built as " KhawajaLabs Project ".

<p>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" />
  <img alt="Node.js + Express" src="https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white" />
  <img alt="PostgreSQL 17" src="https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white" />
  <img alt="TailwindCSS 3" src="https://img.shields.io/badge/TailwindCSS-3-06B6D4?logo=tailwindcss&logoColor=white" />
  <img alt="Deployed on Vercel" src="https://img.shields.io/badge/Deployed%20on-Vercel-000000?logo=vercel&logoColor=white" />
</p>

**🔗 Live demo:** <https://superma-task-management.vercel.app> · **API health:** <https://superma-task-management-37zl.vercel.app/api/v1/health>

---

## Screenshots

### Marketing site

<p>
  <img src="docs/images/home-01-hero.png" width="49%" alt="Suprema landing page — hero" />
  <img src="docs/images/home-05-pricing.png" width="49%" alt="Pricing plans" />
</p>

### Inside the app

<p>
  <img src="docs/images/dash-01-dashboard-top.png" width="100%" alt="Member dashboard — a personalized overview" />
</p>

<p>
  <img src="docs/images/dash-02-projects.png" width="49%" alt="Projects with live progress" />
  <img src="docs/images/dash-03-tasks.png" width="49%" alt="Kanban task board" />
</p>

<p>
  <img src="docs/images/dash-04-calendar.png" width="49%" alt="Calendar of due dates" />
  <img src="docs/images/dash-05-analytics.png" width="49%" alt="Workspace analytics" />
</p>

<p>
  <img src="docs/images/dash-10-search-open.png" width="49%" alt="Global search (Ctrl + K)" />
  <img src="docs/images/login.png" width="49%" alt="Sign-in page" />
</p>

### Everywhere else

<p>
  <img src="docs/images/notfound-404.png" width="65%" alt="Custom 404 page" />
</p>

---

Suprema is two things in one codebase:

- a **public marketing site** (landing page, pricing, blog, changelog, waitlist) built to sell the product
- a **real, working SaaS application** behind login — workspaces, teams, projects, a drag-and-drop Kanban board, comments, attachments, notifications, and an admin panel for managing users

---

## Documentation

Detailed guides live in [`docs/`](docs/README.md):

| Guide | For |
| --- | --- |
| [User Guide](docs/USER_GUIDE.md) | Members and viewers — signing in, projects, tasks, calendar, analytics, search |


## Table of Contents

- [Screenshots](#screenshots)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Default Credentials](#default-credentials)
- [Available Scripts](#available-scripts)
- [Project Structure](#project-structure)
- [Roles & Permissions](#roles--permissions)
- [Notes & Known Behaviours](#notes--known-behaviours)
- [API Reference](#api-reference)
- [Database](#database)
- [Migrations](#migrations)
- [Environment Variables](#environment-variables)
- [Deploying to Vercel](#deploying-to-vercel)

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 8, React Router 7 |
| Styling | TailwindCSS 3, Framer Motion, Lucide React |
| Backend | Node.js, Express 4, Nodemon |
| Database | Supabase (PostgreSQL 17) via the `pg` driver |
| Auth | JWT, bcrypt |
| Security | Helmet, CORS, express-rate-limit, express-validator, RBAC middleware |
| Other | Multer (uploads), Nodemailer (OTP email) |
| Linting | Oxlint |

---

## Quick Start

### Prerequisites

- **Node.js `^20.19.0` or `>=22.12.0`** (required by Vite 8)
- **A Supabase project** (free tier) — the database is PostgreSQL, so there is nothing to install locally

### 1. Install dependencies

```bash
# root - installs client deps
npm install

# server - installs its own deps
cd server && npm install && cd ..
```

### 2. Configure environment variables

```bash
# root
cp .env.example .env          # Windows: copy .env.example .env

# server
cd server && cp .env.example .env && cd ..
```

At minimum, set your database connection string and a real JWT secret in `server/.env`:

```env
# Supabase -> Project Settings -> Database -> Connection string -> URI (Session pooler)
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
JWT_SECRET=change_this_to_a_long_random_string
```

> Use the **Session pooler** URI for the running app: it holds one server connection per client instead of opening a new one per request, which is what keeps a serverless deployment (Vercel) from exhausting Supabase's connection limit.

### 3. Create and seed the database

```bash
npm run db:apply-supabase   # creates the 19 tables in Supabase
npm run db:migrate-data    # copies an existing MySQL database across (optional)
```

`db:apply-supabase` applies `schema.sql` to your Supabase project. `db:migrate-data` copies
the rows of an existing MySQL database (Aiven) into Supabase, preserving every id and
relationship — that is how this project was moved without losing a single account.

> **⚠️ This deletes every account.** `db:init` and `db:reset` drop the schema, so any user
> who registered through the UI is permanently removed. Running it as part of your normal
> startup is the single most common cause of "my account disappeared and can't log in" — and
> the admin panel will not list the user either, because the row genuinely no longer exists.
>
> `db:init` now refuses to run when the database already contains users, and tells you to
> use `npm run dev` instead. If you genuinely want a clean slate, ask for it explicitly:
>
> ```bash
> npm run db:reset        # destructive, on purpose
> ```
>
> To just restart the app afterwards, you only need `npm run dev` — the schema migrates itself on boot.

### 4. Run both servers

```bash
npm run dev
```

- Client → <http://localhost:5173>
- API → <http://localhost:5000>

Or run them separately with `npm run dev:client` and `npm run dev:server`.



### The two login portals

Suprema splits authentication deliberately:

- **`/login`** — public site. Members and viewers sign in here. They see the marketing navbar on dashboard pages.
- **`/admin-login`** (alias `/staff-portal`) — internal staff portal. Admins, developers, and super admins sign in here. The public navbar is **not** rendered on dashboard pages for these accounts, giving a dedicated staff dashboard.

Logging out returns you to whichever portal matches your account.

## Available Scripts

Run from the **root** directory:

| Script | Description |
| --- | --- |
| `npm run dev` | Start client and server together |
| `npm run dev:client` | Start only the Vite dev server |
| `npm run dev:server` | Start only the Express API (nodemon) |
| `npm run start:server` | Start the API without nodemon |
| `npm run db:init` | Create and seed the database. **Refuses to run if the database already has users** |
| `npm run db:reset` | Deliberately drop, recreate, and seed — **destroys all registered accounts** |
| `npm run db:migrate` | Apply pending additive schema migrations (safe) |
| `npm run build` | Production build of the client into `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run Oxlint |

---

## Project Structure

```
.
├── src/                        # React client
│   ├── components/             # Shared UI
│   │   └── dashboard/          # Layout, sidebar, modals, drawers
│   ├── context/AuthContext.jsx # Auth state, session persistence
│   ├── data/                   # Static blog + changelog content
│   ├── pages/                  # Route components
│   ├── utils/api.js            # Fetch wrapper (injects JWT)
│   └── App.jsx                 # Router and layout
│
├── server/                     # Express API
│   ├── config/db.js            # PostgreSQL pool + startup migration guard
│   ├── controllers/            # Request handlers
│   ├── database/
│   │   ├── schema.sql          # Source of truth for a fresh DB
│   │   ├── seed.sql            # Demo data
│   │   └── migrate.js          # Additive, idempotent migrations
│   ├── middleware/             # auth, RBAC, validation, uploads, errors
│   ├── routes/                 # Express routers
│   ├── scripts/                # initDb.js, migrate.js
│   ├── uploads/                # Multer file storage
│   └── server.js
│
└── FullStack_SRS_Suprema.docx  # Software Requirements Specification
```

---

## Roles & Permissions

Roles live in the `users.role` column and drive both the UI and the API via `authorizeRoles`.

| Role | Capabilities |
| --- | --- |
| `super_admin` | Everything, including deleting user accounts |
| `admin` | Manage users, roles, passwords, status, broadcasts |
| `developer` | Same as `admin` |
| `member` | Standard workspace user |
| `viewer` | Read-only |

### Admin panel (`/dashboard/users`)

Visible to `super_admin`, `admin`, and `developer`. Supports:

- listing all users with role, status, workspace count, and join date
- changing roles
- resetting a password (a temporary one is emailed, or printed to the server console without SMTP)
- **suspending / reactivating** an account
- broadcasting an announcement to everyone, or to a specific user
- deleting a user — **super_admin only**

### Profile pictures

**Staff accounts (`super_admin`, `admin`, `developer`) use a fixed role emblem** and cannot upload a photo. The emblem is chosen by the *system* role, so a developer who merely owns a workspace is still treated as staff. It also makes it obvious at a glance which portal someone is in. Their sidebar shows no **My Profile** link, and `/dashboard/profile` is blocked for them by `MemberRoute.jsx`.

**Members and viewers** get a neutral placeholder badge until they upload something. Upload is at **Dashboard → My Profile**, or by clicking your own name in the sidebar footer.

| | |
| --- | --- |
| Formats | PNG, JPEG, GIF, WEBP |
| Max size | 2MB |
| Endpoints | `POST /auth/avatar` (multipart, field `avatar`), `DELETE /auth/avatar` |

`src/utils/avatar.js` exposes `getAvatarUrl(user)`, `getAvatarFor(person, roleKey)`, `isStaffRole(role)` and `canUploadAvatar(role)`. Every avatar in the app goes through it, so the emblem-vs-photo decision is made in exactly one place.

All four badges are local SVGs in `src/assets/` — there is no third-party avatar API, so avatars render identically offline and cannot leak account information to an external service.

The staff restriction is enforced **server-side** in `authController.js` — hiding the upload controls in the UI is only a convenience, and a direct API call would otherwise still succeed.

Validation happens in three layers, because the first two are attacker-controlled:

1. declared MIME type — client supplied, trivially forged
2. file extension — must match that MIME type
3. **magic bytes** — the real leading bytes of the file on disk are compared against the signature for the claimed format, which is what catches an HTML or SVG payload renamed to `.png`

Files are ignored by git. Note that local-disk storage will not survive an ephemeral host such as Vercel — use object storage (S3/Cloudinary) for a real deployment.

### Guards

Several rules are enforced server-side, so they hold even if someone bypasses the UI:

- you cannot change your **own** role, status, or delete your own account
- only a **super_admin** may grant the `super_admin` role
- only a **super_admin** may suspend another super admin
- a suspended account is **blocked at login** with a 403

The client also has a route guard, but it is a UX convenience only — the API is the real boundary.

---

## Notes & Known Behaviours

### Toasts

Action feedback uses a shared toast system (`src/components/toast/`), available anywhere via `useToast()`:

```js
const toast = useToast();
toast.success('Role updated to "developer"');
toast.error(err.message);
toast.info('Workspace switched');
toast.warning('This cannot be undone');
```

Toasts and the bell dropdown are deliberately different: a **toast** is immediate, transient feedback about an action just taken, while the **bell** is a durable inbox of messages still waiting to be read. Replacing one with the other would silently lose messages the user never saw.

### Dashboards

Each role gets a genuinely different dashboard, all composed from the shared primitives in `src/components/dashboard/DashboardShell.jsx` so they still read as one product. Routing is driven purely by the role on the JWT, never by client state.

| Role | Dashboard | Accent | Answers |
| --- | --- | --- | --- |
| `member` / `viewer` | `MemberDashboard.jsx` | indigo | "What is mine?" — my queue, overdue, my projects |
| `developer` | `DeveloperDashboard.jsx` | emerald | "What is the board doing?" — pipeline, throughput, workload |
| `admin` / `super_admin` | `AdminDashboard.jsx` | amber | "Is the platform healthy?" — health, users, audit trail |

Accents are defined once in `src/components/dashboard/accents.js` and applied as CSS custom properties, so a role's entire palette can be re-themed from one file. Shared data loading lives in `src/hooks/useDashboardData.js`.

The admin dashboard's **System health** panel reads `GET /health`, which performs a live `SELECT 1` — it reports real `CONNECTED` / `DISCONNECTED` state plus actual uptime and environment rather than a hardcoded string.

### The "New Task" button

The header's **New Task** button works from every dashboard page, not just the Tasks Board. The modal is rendered by `DashboardLayout` (not by `TasksPage`), because it used to exist only on the board — so clicking the button from Overview set state that nothing was listening to and appeared to do nothing.

- Opened from the **header** → no project in context, so the modal shows a **Project** selector.
- Opened from a **task row** → the project is pre-selected and the selector is hidden.
- **Edit** opens the same modal pre-filled, driven by `editingTask` state lifted into `DashboardLayout` and shared through outlet context.

---

## API Reference

Base URL: `http://localhost:5000/api/v1`

All routes require `Authorization: Bearer <token>` except registration, login, and the health check.

### Auth

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/auth/send-otp` | Email a 6-digit verification code |
| `POST` | `/auth/verify-otp` | Verify code and create the account |
| `POST` | `/auth/register` | Register directly (no OTP) |
| `POST` | `/auth/login` | Log in, returns a JWT |
| `GET` | `/auth/me` | Current user + workspaces |
| `POST` | `/auth/avatar` | Upload profile picture (members/viewers only) |
| `DELETE` | `/auth/avatar` | Remove profile picture |

### Workspaces & Teams

| Method | Endpoint | Query |
| --- | --- | --- |
| `GET` | `/workspaces` | — |
| `POST` | `/workspaces` | — |
| `GET` | `/workspaces/:id/members` | — |
| `POST` | `/workspaces/:id/members` | — |
| `GET` | `/teams` | `workspace_id` |
| `POST` | `/teams` | `workspace_id` |
| `GET` | `/teams/:id/members` | — |

### Projects & Tasks

| Method | Endpoint | Query |
| --- | --- | --- |
| `GET` | `/projects` | `workspace_id`, `team_id`, `status` |
| `POST` | `/projects` | — |
| `GET` | `/projects/:id` | — |
| `PUT` | `/projects/:id` | — |
| `GET` | `/tasks` | `project_id` **or** `workspace_id`, plus `status`, `priority`, `assignee_id`, `parent_id` |
| `POST` | `/tasks` | — |
| `PATCH` | `/tasks/:id/status` | — |
| `DELETE` | `/tasks/:id` | — |

> `GET /tasks` accepts **either** `project_id` or `workspace_id`. If both are supplied, `project_id` wins so a project filter is never silently widened.

### Collaboration

| Method | Endpoint | Query |
| --- | --- | --- |
| `GET` | `/comments` | `task_id` |
| `POST` | `/comments` | — |
| `DELETE` | `/comments/:id` | — |
| `GET` | `/attachments` | `task_id` |
| `POST` | `/attachments` | multipart `file` |
| `DELETE` | `/attachments/:id` | — |
| `GET` | `/notifications` | — |
| `PATCH` | `/notifications/:id/read` | — |
| `PATCH` | `/notifications/read-all` | — |
| `GET` | `/activity` | `workspace_id` |


#### Sending notifications

`POST /admin/notifications/broadcast` supports both recipients in one endpoint:

```jsonc
// everyone (omit user_ids, or pass [])
{ "title": "Maintenance tonight", "message": "Downtime 10pm-11pm", "type": "announcement" }

// one or more specific users
{ "title": "Please review", "message": "Task 42 is assigned to you", "type": "task_assigned", "user_ids": [4, 7] }
```

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | max 200 chars |
| `message` | yes | |
| `type` | no | `info` (default) · `task_assigned` · `mention` · `system` · `announcement` |
| `link` | no | optional deep link |
| `user_ids` | no | array of user IDs. Omit or pass `[]` to notify **everyone** |

Unknown `user_ids` are skipped rather than failing the whole send, and the response reports what was skipped. Rows are inserted in a single transaction, so a partial broadcast is not possible.

### Health

`GET /health` (also mounted at `/api/v1/health`) returns service status.

---

## Database

PostgreSQL (Supabase), 19 tables:

```
users                 workspaces          workspace_members
teams                 team_members        projects
tasks                 task_comments       task_attachments
activity_logs         notifications       email_verifications
```

Notable constraints:

- `users.email` is unique
- `users.role` is an enum: `super_admin, admin, developer, member, viewer`
- `users.status` is an enum: `active, inactive, suspended`
- `tasks.parent_id` self-references, enabling subtasks

Registering creates a user with role `member` and status `active`, and automatically provisions a personal workspace with that user as `owner`.

---

## Migrations

`server/database/schema.sql` is the source of truth for a **fresh** database. Databases created **before** a schema change keep the old definition, so Suprema ships additive migrations in `server/database/migrate.js`:

| Migration | Purpose |
| --- | --- |
| `001-users-role-enum-includes-developer` | Adds `developer` to the `users.role` enum |
| `002-repair-blank-user-roles` | Resets roles that were silently blanked to `member` |

**These run automatically when the server starts.** You normally do nothing. To apply them without starting the API:

```bash
npm run db:migrate
```

Migrations must stay **idempotent** (safe on every boot) and **non-destructive** (never drop or rewrite valid data).




## Deploying to Vercel

The frontend deploys as-is (Vite + `VITE_API_URL`). The backend is a standard
Express app that already exports its `app`, so Vercel detects it automatically —
but **two platform constraints must be solved first**, or the deploy "succeeds"
while the API silently breaks:

1. **Database** — Vercel hosts no database. Point the API at Supabase with a
   `DATABASE_URL` (the **Session pooler** URI — see below).
2. **File uploads** — Vercel's filesystem is read-only. Whenever
   `CLOUDINARY_URL` is set, avatars and task attachments are stored on
   Cloudinary and DB rows hold the absolute URL; without it, files fall back to
   `server/uploads/` (local development only).

### 1. Supabase (one-time)

1. Create a free project at [supabase.com](https://supabase.com/dashboard) — no
   credit card required.
2. **Region matters.** Pick the region closest to where Vercel runs your
   functions. Vercel's default region is `iad1` (Washington DC, Virginia), so
   choose **US East (North Virginia)**. The API and the database then sit in the
   same region and every query is a local round trip.
3. Project → **Settings → Database** → **Connection string** → **URI**:
   - **Session pooler** (port `5432`) → this is the `DATABASE_URL` for the app
   - **Direct connection** (port `5432` on `db.<ref>.supabase.co`) → used by
     the migration scripts
4. Apply the schema, and copy any existing data across:
   ```bash
   npm run db:apply-supabase   # creates the 19 tables
   npm run db:migrate-data    # copies an existing MySQL database across
   ```
5. Put the connection string in `server/.env` and run `npm run dev` locally to
   confirm everything works against Supabase before deploying.

> **Why the Session pooler and not the direct connection?** On Vercel every
> request can spin up a fresh function, and each one would open its own
> database connection. The pooler multiplexes them through a single gateway, so
> a burst of traffic cannot exhaust Supabase's connection limit.

### 2. Cloudinary for uploads (one-time)

1. Create a free account at [cloudinary.com](https://cloudinary.com) and copy the
   **Cloudinary URL** from *Settings → API Keys* (`cloudinary://key:secret@cloud`).
2. Add it to `server/.env` and upload a profile picture locally to verify.
3. If your database already contains locally stored files, migrate them once:
   ```bash
   cd server
   node scripts/migrate-uploads-to-cloud.js
   ```

### 3. Deploy the backend

1. Push the repository to GitHub.
2. [vercel.com/new](https://vercel.com/new) → import the repo → set
   **Root Directory = `server`** → Deploy. Vercel detects the Express entry point
   (`server.js`) and needs no `vercel.json`.
3. Project → **Settings → Environment Variables**, then redeploy:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase **Session pooler** URI (port `5432`) |
   | `DB_CONNECTION_LIMIT` | `5` (free tiers cap total connections) |
   | `JWT_SECRET` | a long random string — never the dev fallback |
   | `NODE_ENV` | `production` |
   | `CLIENT_ORIGIN` | `https://<your-frontend>.vercel.app` (comma-separated for several) |
   | `CLOUDINARY_URL` | `cloudinary://key:secret@cloud` |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | for OTP emails |
   | `GOOGLE_CLIENT_ID` | OAuth client ID, only if Google sign-in is enabled |

   `server/.env` is **not** committed to git, so these dashboard values are the
   only copy Vercel will see.
4. Verify `https://<backend-host>/health` returns `{"status":"UP"}` and that a
   login round-trip works.

### 4. Point the frontend at the backend

In the **frontend's** Vercel project → Settings → Environment Variables:

```env
VITE_API_URL=https://<backend-host>/api/v1
VITE_GOOGLE_CLIENT_ID=<same OAuth client ID as the backend>
```

then redeploy. The committed root `.env` still contains
`http://localhost:5000/api/v1`; dashboard variables take precedence over it, but
if `VITE_API_URL` is never set the deployed site ships with the localhost value.

### Google sign-in setup

Google sign-in is optional. Leave both client ID variables empty and the button
is hidden entirely rather than left on a page that cannot work.

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application**
2. Under **Authorised JavaScript origins**, add every origin the app is served
   from — scheme and port included, **no trailing slash**:

   ```text
   http://localhost:5173
   http://localhost:4173
   https://<your-frontend>.vercel.app
   ```

   A missing or misspelled origin fails as Google's
   `Error 400: redirect_uri_mismatch`, which appears inside the pop-up window
   rather than on your page.
3. Set the same client ID as both `GOOGLE_CLIENT_ID` (backend) and
   `VITE_GOOGLE_CLIENT_ID` (frontend).
4. New apps start in **Testing** publishing status: add each account that needs
   to test under **Test users** on the consent screen, or Google blocks sign-in
   with "Access blocked".

Sign-in creates a plain **member** account and can never create or grant a staff
role. An address that already exists keeps its existing role, so staff are never
promoted or demoted through this path. Accounts are only accepted when Google
reports the email as verified.

### Platform limits to know about

- **4.5 MB max request body** on Vercel — the attachment upload cap (10 MB in
  dev) effectively becomes 4.5 MB in production.
- The rate limiter is in-memory: counts are per function instance, not global.
- Supabase's free tier pauses a project after a period of inactivity — wake it
  from the console (you get an email first).
- **The database and the API should share a region.** Supabase lets you pick
  one when you create the project; match it to Vercel's function region
  (`iad1` by default) so a query is a local round trip rather than an
  inter-continent one.
- Deploy previews have their own origin; append it to `CLIENT_ORIGIN` if API
  calls from a preview must work.
- If Vercel serves the raw source instead of the API, add a `server/vercel.json`
  with `{"rewrites": [{"source": "/(.*)", "destination": "/server.js"}]}` as the
  documented fallback.


