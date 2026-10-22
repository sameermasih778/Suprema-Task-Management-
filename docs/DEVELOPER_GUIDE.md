# Suprema — Developer Guide

For an engineer joining the project for the first time.

---

## 1. What you are working with

A **monorepo** with two deployable units:

```
.
├── src/                  Frontend — React 18 + Vite + React Router + Tailwind
├── server/               Backend  — Express + Supabase PostgreSQL (node-postgres)
├── docs/                 These guides
├── scripts/              Post-build helper (SPA 404 handling)
├── vercel.json           SPA rewrites + build settings
└── package.json          Root scripts that orchestrate both halves
```

**Request flow:** browser → Vercel frontend (static React bundle) → calls the
backend at `/api/v1` → Express middleware → controllers → Supabase PostgreSQL.

The frontend never talks to the database directly, and the API never returns HTML.

---

## 2. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 18+ | 20 LTS recommended — the backend uses global `fetch` |
| npm | 9+ | Ships with Node |
| Database | — | PostgreSQL is fully hosted on Supabase; nothing to install |
| Git | any | |

Optional but strongly recommended: **Cloudinary** and a **Vercel**
account for a production-like environment.

---

## 3. Getting it running

```bash
git clone https://github.com/sameermasih778/Superma-Task-Management-.git
cd Suprema-Task-Management-
npm install
cd server && npm install && cd ..

# frontend
cp .env.example .env

# backend
cp server/.env.example server/.env
```

Fill in `server/.env` (see section 4), then:

```bash
npm run dev
```

That runs the Vite dev server and the Express server together.

| URL | What |
| --- | --- |
| `http://localhost:5173` | Frontend |
| `http://localhost:5000/api/v1` | Backend API |
| `http://localhost:5000/api/v1/health` | Health check |

### Scripts

**Root**

| Command | Does |
| --- | --- |
| `npm run dev` | Frontend + backend together |
| `npm run dev:client` | Vite only |
| `npm run dev:server` | Express only (`nodemon`) |
| `npm run build` | Production build; `postbuild` copies the SPA 404 page |
| `npm run lint` | `oxlint` across the repo |
| `npm run preview` | Serve the production build locally |

**Server**

| Command | Does |
| --- | --- |
| `npm start` | Run the server |
| `npm run dev` | Run with `nodemon` |
| `npm run db:init` | Create schema **and** load demo data |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:reset` | Drop and rebuild (destructive) |

> There is no `test` script. See [section 11](#11-testing-status).

---

## 4. Environment variables

### `server/.env`

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | yes | `5000` locally |
| `NODE_ENV` | yes | `development` / `production` |
| `CLIENT_ORIGIN` | yes | Comma-separated allowed origins, for CORS |
| `DATABASE_URL` | yes | Supabase PostgreSQL connection string (session pooler URI) |
| `DB_CONNECTION_LIMIT` | production | `5` — free tiers cap total connections |
| `JWT_SECRET` | **yes** | Long random string. **Never the dev fallback in production** |
| `JWT_EXPIRES_IN` | yes | e.g. `7d` |
| `CLOUDINARY_URL` | production | `cloudinary://key:secret@cloud`. Unset = local disk |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | optional | OTP email. Unset = codes logged to console |
| `SMTP_WAIT_MS` | optional | Bound on SMTP latency; the email still sends in the background |
| `GOOGLE_CLIENT_ID` | optional | Enables Google sign-in |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` | optional | Global API limiter |

### `.env` (frontend)

| Variable | Notes |
| --- | --- |
| `VITE_API_URL` | e.g. `http://localhost:5000/api/v1` |
| `VITE_GOOGLE_CLIENT_ID` | Must match the backend's `GOOGLE_CLIENT_ID` |

> **`Vite` reads env at build time.** Editing a `VITE_*` value on Vercel changes
> nothing until the project is **rebuilt**. This has caused more wasted time
> than any other configuration issue in this project.

**Never commit `.env`.** Both `.env` and `*.env` are gitignored; only the
`.env.example` templates are tracked. Real secrets have been committed here
before, so treat any secret that reaches a commit as compromised and rotate it.

---

## 5. Database and migrations

Migrations live in `server/database/migrate.js` and run automatically on boot.

**They are idempotent.** Each one queries `information_schema` to check whether
its change already exists and skips if so. There is no migration history table,
and the numeric IDs are labels, not an ordering dependency — a gap in the
numbering is harmless.

`server/database/schema.sql` is the base schema (creates all tables).
`server/database/seed.sql` loads demo users, workspaces, teams and projects.

### Connection behaviour

`server/config/db.js` centralises this and handles the real-world trap:

- **Connection multiplexing** — a Supabase free tier caps total connections, so
  every process uses a bounded pool (`DB_CONNECTION_LIMIT`). The app talks to the
  **session pooler** gateway rather than the database directly, so a burst of
  serverless instances on Vercel cannot exhaust it.

---

## 6. Architecture

```
Browser
  │
  ▼
React (src/)
  ├── context/AuthContext.jsx     Session state, hydrated synchronously from
  │                               localStorage to avoid a login flicker
  ├── components/dashboard/       Sidebar, board, drawer, modals
  └── pages/                      Route components
  │
  ▼  fetch, Authorization: Bearer <jwt>
Express (server/server.js)
  ├── helmet, cors, rate limiters
  ├── /api/v1 → routes/index.js
  │     ├── authRoutes + rate limiting
  │     ├── marketingRoutes      public: pricing, changelog, contact, waitlist
  │     └── resource routes + authenticateToken + authorizeRoles
  ├── middleware/errorHandler.js  One place that decides what a client sees
  └── config/                     db, mailer, assetStorage
```

### Two storage modes

`server/config/assetStorage.js` abstracts avatars and attachments. With
`CLOUDINARY_URL` set, files go to Cloudinary; without it they go to
`server/uploads/`. The rest of the codebase does not know which is active.

**One trap worth knowing:** the avatar pipeline previously failed on Vercel
because Helmet's default `Cross-Origin-Resource-Policy: same-origin` blocked the
browser from rendering images served by the API. It is scoped to `cross-origin`
for `/uploads` only. Do not remove that without testing image rendering on the
deployed site.

### Mail

`server/config/mailer.js` uses a **pooled** transport. Gmail's TLS handshake
takes 15–23 seconds on first use, so paying it once per process instead of once
per email cut the first send from 15.4s to ~2s. `SMTP_WAIT_MS` bounds the wait —
if SMTP is slow, the API responds and the email goes in the background.

### Error handling

`server/middleware/errorHandler.js` is the single place that decides what the
client sees:

- **4xx** — the message comes from our own controller and is safe to return.
- **5xx** — the message is replaced with a generic one. Raw `err.message` used to
  leak SQL fragments and hostnames to the public internet. The full error is
  logged server-side.

---

## 7. Authentication and authorisation

### Passwords

- Registration is **two-step**: request a 6-digit OTP, then `verify-otp` creates
  the account. Codes expire after 10 minutes.
- Passwords are **bcrypt** hashed. bcrypt only accepts 8–72 bytes; validation
  enforces that range so an admin-supplied password can never fail to hash.
- The login limiter allows 20 failures per 15 minutes per identifier and
  **skips successful requests**, so an active user is never locked out by their
  own successful logins.

### Google sign-in

`POST /auth/google` accepts two credential types:

- **ID token** (three dot-separated segments) — verified cryptographically
  against Google's public keys, including audience and expiry.
- **Access token** (opaque) — the popup flow our own button uses. Verified by
  asking Google who the token belongs to.

Either way the profile used comes from Google, never from the browser.

Guarantees enforced server-side:

- New accounts are **always** created as `member`. Staff roles are unreachable
  through this path.
- An email that already exists keeps its existing role.
- The email must be reported **verified** by Google.
- Suspended accounts are refused even with a valid Google identity.

### Self-service password reset

`server/controllers/passwordResetController.js`, with tokens in
`password_reset_tokens` (migration 008). Four decisions are worth knowing before
you change anything here:

1. **No user enumeration.** `/forgot-password` returns the same 200 and the same
   message whether or not the address is registered, and does comparable work
   in both branches so response time does not leak it either.
2. **Tokens are stored as SHA-256 hashes**, never in plaintext — a stolen
   database dump must not yield usable reset links.
3. **Single use and short life.** `used_at` is stamped on consumption, expiry is
   30 minutes, and requesting a new link deletes any outstanding one. The claim
   is `UPDATE ... WHERE used_at IS NULL` and checks `affectedRows`, so a token
   cannot be spent twice even if two requests race.
4. **Expiry is decided by the database, never in Node.** This is the subtle one:
   timestamp comparisons therefore live in SQL (`expires_at > NOW()`), using the
   database's own clock and timezone, exactly as the signup OTP flow already
   does. Mixing Node's local clock with a UTC-stored timestamp reports a token as
   expired the instant it is issued in a non-UTC timezone. **Do not reintroduce
   `new Date(row.expires_at)` comparisons.**

In development with no SMTP configured, the API returns `devResetUrl` so the
flow is testable. It is never returned when `SMTP_USER` is set, so production
cannot be used to request a link against someone else's address.

### Roles

`authorizeRoles(...roles)` is applied per route.

| Role | Scope |
| --- | --- |
| `super_admin` | Everything, plus delete users |
| `admin`, `developer` | User management, broadcasts |
| `member`, `viewer` | Work inside their workspaces |

Workspaces add a second axis: `owner`, `admin`, `member`, `guest`.

### Team ownership

`teams.created_by` records the creator. `canManageTeam` allows **any** staff
account to manage **any** team, while a member may only manage teams they
created. The rule is enforced server-side and mirrored in the UI — hiding a
button is not access control.

---

## 8. API reference

Base path: `/api/v1`. Authenticated routes take
`Authorization: Bearer <token>`.

### Health

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | public |

### Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/auth/send-otp` | public | Rate limited; honest failure if delivery fails |
| `POST` | `/auth/verify-otp` | public | Creates the account |
| `POST` | `/auth/register` | public | |
| `POST` | `/auth/login` | public | `authRateLimiter` |
| `POST` | `/auth/google` | public | `authRateLimiter` |
| `POST` | `/auth/forgot-password` | public | `authRateLimiter`; never reveals whether the address exists |
| `GET` | `/auth/reset-password/verify?token=` | public | Lets the form check the link before typing |
| `POST` | `/auth/reset-password` | public | `authRateLimiter`; single-use token |
| `GET` | `/auth/me` | user | Current profile |
| `POST` | `/auth/avatar` | user | Multipart, images only, 2 MB |
| `DELETE` | `/auth/avatar` | user | Falls back to initials |

### Workspaces

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/workspaces` | user |
| `POST` | `/workspaces` | user |
| `GET` | `/workspaces/:id/members` | member |
| `POST` | `/workspaces/:id/members` | owner/admin |

### Projects

| Method | Path | Auth |
| --- | --- | --- |
| `GET` `POST` | `/projects` | user |
| `GET` `PUT` | `/projects/:id` | user |

### Tasks

| Method | Path | Auth |
| --- | --- | --- |
| `GET` `POST` | `/tasks` | user |
| `GET` `PUT` `DELETE` | `/tasks/:id` | user |
| `GET` | `/tasks/:id/subtasks` | user |
| `PATCH` | `/tasks/:id/status` | user |

Filters: `project_id`, `workspace_id`, `status`, `priority`, `assignee_id`,
`parent_id`.

### Teams

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/teams` · `/teams/mine` | user |
| `POST` | `/teams` | user |
| `GET` `POST` | `/teams/:id/members` | user / manager |
| `DELETE` | `/teams/:id/members/:userId` | manager |
| `DELETE` | `/teams/:id` | manager |

### Comments and attachments

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/comments?task_id=` | user | |
| `POST` | `/comments` | user | |
| `DELETE` | `/comments/:id` | author only | Enforced: "You can only delete your own comments" |
| `GET` | `/attachments?task_id=` | user | |
| `POST` | `/attachments` | user | Multipart, size-capped by the platform |
| `DELETE` | `/attachments/:id` | uploader, workspace owner/admin, or staff | Ownership enforced server-side |

### Notifications and activity

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/notifications` | user |
| `PATCH` | `/notifications/:id/read` | user |
| `PATCH` | `/notifications/read-all` | user |
| `GET` | `/activity` | `super_admin`, `admin`, `developer` | Role-gated to match the staff-only page |

### Admin

| Method | Path | Roles |
| --- | --- | --- |
| `GET` | `/admin/users` | `super_admin`, `admin`, `developer` |
| `PATCH` | `/admin/users/:id/role` | staff |
| `PATCH` | `/admin/users/:id/reset-password` | staff |
| `PATCH` | `/admin/users/:id/status` | staff |
| `DELETE` | `/admin/users/:id` | `super_admin` only |
| `POST` | `/admin/notifications/broadcast` | staff |
| `GET` | `/admin/leads/contact` | staff |
| `PATCH` | `/admin/leads/contact/:id/status` | staff |
| `GET` | `/admin/leads/waitlist` | staff |
| `PATCH` | `/admin/leads/waitlist/:id/status` | staff |
| `GET` | `/admin/leads/export?type=contact\|waitlist` | staff |
| `GET` | `/admin/changelogs` | staff |
| `POST` | `/admin/changelogs` | staff |
| `PUT` | `/admin/changelogs/:tagId` | staff |
| `DELETE` | `/admin/changelogs/:tagId` | staff |

### Lead Inbox

`server/controllers/leadsController.js` surfaces the marketing funnels to staff
at `/dashboard/leads`. Before it existed the contact form and waitlist were
writing rows that **no one could read**.

The CSV export deliberately does not use the shared `api` helper: that helper
parses every response as JSON, which would discard the file. It fetches the raw
response as a blob instead. Cell values are quoted and embedded quotes doubled,
because a customer writing `Smith, John` otherwise shifts every column in Excel;
a UTF-8 BOM is included so accented names are not mangled.

Leads are platform-level rather than workspace-level, so status changes are
deliberately **not** written to `activity_logs` — that table is keyed by
`workspace_id`, and inventing a workspace for the entry would produce a
misleading audit trail. If lead auditing is ever needed, add a dedicated table.

### Marketing (public)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/pricing` | Plans from the database |
| `GET` | `/changelogs` | Newest first |
| `POST` | `/contact` | `formLimiter` |
| `POST` | `/waitlist` | `leadLimiter`; real queue position + referral code |

---

## 9. Deployment

Both units deploy to Vercel as separate projects.

### Backend

- Root directory: `server`
- Deploys automatically on push to `main`
- All environment variables are set in the **dashboard** — `server/.env` is
  gitignored, so Vercel cannot see it

### Frontend

- Static build (`npm run build`)
- `vercel.json` rewrites unknown paths to `/index.html` so deep links like
  `/dashboard/tasks` survive a refresh
- `scripts/copy-404.js` runs as `postbuild` to provide that SPA fallback page

### Media and email

Cloudinary for avatars and attachments; SMTP for OTP and password emails. Both
degrade gracefully: without Cloudinary, files go to local disk (which does not
persist on serverless, so it is development-only); without SMTP, OTPs print to
the server console.

### Platform limits worth remembering

- **4.5 MB request body** on Vercel — the attachment upload cap is effectively
  4.5 MB in production, even though local dev allows 10 MB.
- **Database idle sleep** — a free-tier provider powers itself off. See
  [troubleshooting](#12-troubleshooting).

---

## 10. Conventions

- **Tailwind for styling.** No separate CSS framework.
- **API responses** are always `{ success, message, ... }`, never a bare object
  or a bare string.
- **Every list endpoint** must check authorisation before querying.
- **Never trust the client** for identity, role, ownership or file identity.
- Comments explain **why**. The code already says what.
- **Rate limiting** on anything that accepts a credential or public input:
  `formLimiter` for forms, `leadLimiter` for marketing, `authRateLimiter` for
  sign-in.
- **Report outcomes honestly.** If an email was not sent, say so. A success
  message for a failed action is a bug.

---

## 11. Automated tests

The backend runs a Jest + Supertest suite from the `server/` directory:

```bash
cd server
npm test          # run everything
npm run test:watch
```

74 tests across 5 files, taking roughly a minute against the hosted database.

### 11.1 The safety rules

The suite never touches production, and it refuses to start if it cannot
guarantee that. `tests/testEnv.js` is loaded before any application module, and
it fails the run rather than degrading:

| Guard | Why |
| --- | --- |
| `DB_SEARCH_PATH` must start with `suprema_test_` | The pool reads the search path at require time, so every query is pinned to a disposable test schema. The run aborts if the override has not landed. |
| `.env` is read back and compared | If a run were pointed at `public`, tests could touch the production tables. The harness refuses rather than degrading. |
| SMTP credentials are forced empty | Otherwise tests would send genuine reset emails to genuine people. |

`tests/globalSetup.js` (per Jest worker) creates a **fresh schema with a unique
name** (`suprema_test_<base36>`) on Supabase, loads `schema.sql`, applies the
migrations and seeds the users covering every role under test plus a workspace,
project, task and attachment. Postgres has no cheap per-database isolation like
MySQL, so tests isolate by **schema** instead — one schema per run, never shared.
Old schemas from previous runs are dropped by `npm run db:clean-test-schemas`
(with a lock timeout, so a stuck one cannot wedge the cleanup).

SMTP is blanked rather than deleted on purpose. `dotenv` repopulates any key that
is absent from `process.env`, so deleting `SMTP_USER` would put the real
credentials straight back the moment `config/db.js` loaded.

Rate limiters are disabled under `NODE_ENV=test`. A suite that fires hundreds of
requests from one address is exactly what they exist to reject, and a throttled
test fails depending on which file ran first.

### 11.2 What is covered

| File | Covers |
| --- | --- |
| `smoke.test.js` | The harness itself - correct database, no SMTP, schema present, fixtures intact. If this fails nothing else should be trusted. |
| `password-reset.test.js` | No user enumeration, tokens stored as SHA-256, single use, 30-minute expiry, and the old password failing afterwards. |
| `authorization.test.js` | The audit feed being staff-only, and attachment deletion restricted to uploader / workspace owner / workspace admin / staff. |
| `changelog.test.js` | CRUD validation, duplicate tags, one-bullet-per-line conversion, and newest-first ordering on the public endpoint. |
| `leads.test.js` | Contact and waitlist capture, queue positions, duplicate signups, status changes, and CSV quoting. |

**Still untested**, in the order worth doing next:

1. **Google sign-in guarantees** - that a new signup is always `member`, that an
   existing role is preserved, and that unverified emails are refused. This needs
   a fake token signer, which is real work rather than a quick addition.
2. **OTP signup** - issuance, expiry and the single-use claim.
3. **Workspace and team authorization** - member-managed teams are the other
   place a real breach would come from.

### 11.3 Known authorisation gaps — both fixed

Two gaps were found while documenting the API, and both were closed in the same
day. They are recorded here rather than quietly deleted, because "we found a
vulnerability during a documentation audit and fixed it" is worth more than a
guide that pretends the problem never existed.

| Endpoint | Gap found | Fix |
| --- | --- | --- |
| `DELETE /api/v1/attachments/:id` | **No ownership check.** Any authenticated user could delete any attachment in any workspace by supplying its ID; workspace membership was never even verified. | The row is now loaded joined to its workspace, and deletion is allowed only for the uploader, a workspace `owner`/`admin`, or staff. Mirrors the rule `deleteComment` already enforced. |
| `GET /api/v1/activity` | Required authentication but **not a staff role**, while the page using it was staff-only — so any member could read the audit trail. | `authorizeRoles('super_admin', 'admin', 'developer')` added to the route, matching the UI. |

Verified against the running API with real rows: a non-uploader receives `403`,
the uploader and staff both receive `200`, and a member receives `403` on the
activity feed while staff pass through.

---

## 12. Troubleshooting

### "Something went wrong on our end"

A 5xx. The real message is logged server-side and deliberately **not** returned
to the browser. Check the logs. In practice this is nearly always the database
being asleep.

### Database asleep — the most common issue

Free-tier databases power off when idle, and their hostname leaves DNS while
asleep. Data is safe.

1. Power the service on in the provider's console; wait for `RUNNING`.
2. Confirm `"database":"CONNECTED"` on `/api/v1/health`.

### Google sign-in fails in a new way every time

| Message | Cause |
| --- | --- |
| `redirect_uri_mismatch` | Origin missing from **Authorised JavaScript origins** |
| `invalid_client` | Wrong client ID — usually a truncated paste |
| "not configured on this server" | `GOOGLE_CLIENT_ID` missing from the **backend** |
| "Access blocked: not a test user" | Email not listed as a test user |
| Button spins forever | Fixed — but check the watchdog message |

Remember: `VITE_GOOGLE_CLIENT_ID` is a **frontend** variable, `GOOGLE_CLIENT_ID`
is **backend**. Both are needed and both must match.

### Avatars do not render in production but work locally

Check that `/uploads` still has `Cross-Origin-Resource-Policy: cross-origin`.
See section 6.

### Emails never arrive

Without `SMTP_*` the OTP is printed to the server console — which on Vercel means
you cannot see it. Configure SMTP, or read the code from the logs. The app tells
you honestly whether it sent; it never claims success falsely.

### A route 404s in production but works locally

Check the file was actually committed and pushed, and that a deployment ran for
that commit. The frontend also needs a **rebuild** when a `VITE_*` variable
changes.

### Local server keeps using old environment values

`nodemon` does not watch `.env`. Restart it.