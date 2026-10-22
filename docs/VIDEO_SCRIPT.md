# Suprema — Video Walkthrough Script

A complete recording plan. Follow it shot by shot: each shot says what to do on
screen and what to say. Record it in order and you have a finished video.

**Target length:** 12–15 minutes for the full version. A 90-second cut is listed
in section 8 if you need something short.

---

## 1. Before you record

Do these first — every one of them has ruined a take at some point.

| # | Task | Why |
| --- | --- | --- |
| 1 | **Power the database on** and confirm it reads `RUNNING` | A sleeping database makes every sign-in fail on camera |
| 2 | Open `.../api/v1/health` in a tab — confirm `"database":"CONNECTED"` | Your proof the app is live before you start |
| 3 | Sign in once as an admin and once as a member | Warm the accounts so no email code is needed on camera |
| 4 | Seed a little realistic data | 3–5 projects, 10–15 tasks, some overdue, 2 teams. Empty screens look unfinished |
| 5 | Close every notification, tab and extension | One stray tab in the taskbar undoes the whole video |
| 6 | Use a **1920×1080** window at 125% zoom | Text is readable on a laptop screen |
| 7 | Turn on **Do Not Disturb** on your phone and computer | A notification mid-sentence is a re-take |
| 8 | Write the demo account emails somewhere off-camera | You must never show a password being typed |

**Recording settings:** 1920×1080, 30 fps, microphone checked in a 10-second test
clip. Narrate a little quieter than feels natural — it fixes both hiss and
clipping.

---

## 2. Part 1 — What Suprema is (0:00–1:15)

### Shot 1.1 — The marketing home page
**Do:** Open `https://superma-task-management.vercel.app`. Let the hero section
load. Scroll slowly down the page.

**Say:**
> "This is Suprema, a multi-tenant task management platform for software teams.
> Everyone starts here, on the public site — the product overview, pricing, and
> the ways to get in touch."

### Shot 1.2 — Feature highlights
**Do:** Scroll to the feature grid and the how-it-works section.

**Say:**
> "The site explains the product and the workflow: you organise work into
> projects, break projects into tasks, and track those tasks from to-do through
> to done."

### Shot 1.3 — Pricing
**Do:** Navigate to **Pricing**. Click the **Yearly** toggle.

**Say:**
> "Pricing is loaded live from our database, not hard-coded. Switching between
> monthly and yearly recalculates every plan — twelve dollars a month, or ten on
> the yearly plan."

### Shot 1.4 — Changelog
**Do:** Navigate to **Changelog**.

**Say:**
> "The changelog is also database-backed and ordered newest first, so you can see
> what shipped and when."

> **Tip:** this shot is worth its 15 seconds — it demonstrates that the marketing
> site talks to a real API rather than static content.

---

## 3. Part 2 — Getting in (1:15–2:30)

### Shot 2.1 — Signing in with Google
**Do:** Go to `/login`. Point at **Continue with Google**, click it, complete the
Google popup quickly, and land back on the app.

**Say:**
> "Members can sign in with Google in one click. Google verifies the email and
> confirms it is verified, and only then will we create an account — and it is
> always created as a standard member. This path can never create or promote an
> administrator, and if you already have an account you keep exactly the role you
> had."

### Shot 2.2 — The staff door
**Do:** Show the address bar with `/admin-login`, then go back to `/login`.

**Say:**
> "Staff use a completely separate sign-in page. Separating the two doors means
> an administrator account can never be created or authenticated through a
> third-party identity provider like Google."

### Shot 2.3 — Email sign-in
**Do:** Show the email and password form without actually submitting it.

**Say:**
> "The traditional route is still here: email and password, with a six-digit
> verification code sent at registration. Login attempts are rate limited, so
> someone cannot simply guess passwords."

---

## 4. Part 3 — The member experience (2:30–7:30)

### Shot 3.1 — Overview
**Do:** Land on `/dashboard`.

**Say:**
> "This is the overview. It is personalised — your task queue, your deadlines,
> and the projects you are contributing to. Nothing you do not need."

### Shot 3.2 — Global search
**Do:** Press **Ctrl + K**. Type a project name. Arrow down, press Enter.

**Say:**
> "One shortcut gets you anywhere. Control K searches across projects, tasks and
> teams at the same time, and I can jump straight to a result with the keyboard.
> This is the fastest way to move around the whole app."

### Shot 3.3 — Projects
**Do:** Go to **Projects**. Open one. Point out the status.

**Say:**
> "Projects group related work — say, a mobile app launch. Each has a status:
> planning, active, on hold, completed or archived."

### Shot 3.4 — The tasks board
**Do:** Go to **Tasks Board**. Show the Kanban columns.

**Say:**
> "Here is the core of the product. Every task moves through four stages: to-do,
> in progress, in review, and done. This board view shows the flow of work across
> the whole workspace at a glance."

### Shot 3.5 — Drag a task
**Do:** Drag a card from **To Do** to **In Progress**.

**Say:**
> "Moving a card is the update — no forms, no confirmation dialog. And every one
> of these movements is recorded in the activity feed, with who did it and when."

### Shot 3.6 — List view and filters
**Do:** Switch to **List** view. Apply a filter — assignee, then priority, then
search text. Then hit **Reset**.

**Say:**
> "The same data in table form. The filter bar narrows by assignee, by deadline —
> overdue, due today, due this week — by priority, and by text search. Filters
> combine, so I can ask a precise question: what is overdue, urgent, and assigned
> to me?"

### Shot 3.7 — The task drawer
**Do:** Click any task to open the drawer. Show the three tabs.

**Say:**
> "Every task opens a detail panel. Subtasks break the work into steps. Comments
> keep the discussion attached to the task instead of scattered across email.
> And attachments hold the files — design files, documents, screenshots."

### Shot 3.8 — Time tracking
**Do:** In the drawer, show the time tracker and click **+1h**.

**Say:**
> "If a task has an estimated hour budget, you log what you actually spent. Quick
> buttons for half an hour, an hour, two hours, or an exact value. The tracker
> warns you the moment you go over estimate — which is the number project
> managers actually care about."

### Shot 3.9 — Calendar
**Do:** Go to **Calendar**. Point at today's highlight and an overdue task.

**Say:**
> "The calendar plots every task on its due date. Overdue work is visible
> immediately, which makes this the fastest way to answer the Monday morning
> question: what is on fire?"

### Shot 3.10 — Analytics
**Do:** Go to **Analytics**. Point at completion rate, hours versus estimate,
then the per-member workload table.

**Say:**
> "Analytics answers how the work is actually going — completion rate, hours
> logged against hours estimated, and how much is in flight right now. The
> workload table per member is how you spot someone overloaded before it becomes
> a missed deadline."

### Shot 3.11 — Teams
**Do:** Go to **Teams**, open a team.

**Say:**
> "Teams group the people. And there is a real permission rule here: staff can
> manage any team, but a member can only manage the teams they created. That rule
> is enforced on the server, not just hidden in the interface."

### Shot 3.12 — Profile
**Do:** Open **My Profile**.

**Say:**
> "Your profile holds your name, your avatar, and your password. If you do not
> upload a picture, we generate initials — so nobody ever has a blank face."

---

## 5. Part 4 — The admin experience (7:30–10:30)

### Shot 4.1 — Staff sign-in
**Do:** Sign out. Go to `/admin-login`. Sign in as the super admin.

**Say:**
> "Administrators use a separate portal, and their landing page is different —
> it is an oversight view rather than a personal to-do list."

### Shot 4.2 — System health
**Do:** Point at the System health panel.

**Say:**
> "The first thing here is system health — a live check that the API is running
> and that it can reach its database. When something breaks, this is where you
> start, and it saves a lot of guessing."

### Shot 4.3 — User management
**Do:** Go to **User Management**. Search for a user.

**Say:**
> "Here is the whole user directory, searchable by name, email, role or status."

### Shot 4.4 — Changing a role
**Do:** Open a row menu → **Change role** → pick a role → confirm. Then show a
member's row where the option is restricted.

**Say:**
> "Roles are enforced here. You cannot grant a role stronger than your own, and
> you cannot change your own role — otherwise an administrator could accidentally
> lock themselves out. Notice this member cannot be promoted; that requires an
> administrator."

### Shot 4.5 — Resetting a password
**Do:** Open **Reset Password** on a user. Show both options — set a specific
password, or generate one automatically. Show the confirmation message.

**Say:**
> "If somebody is locked out, we reset their password. We can set a specific one
> or generate a cryptographically random one. Every reset is written to the audit
> log. And notice what this message does *not* say — it does not claim an email
> was sent when no mail server is configured. The system reports honestly."

### Shot 4.6 — Suspend versus delete
**Do:** Show the **Suspend** action.

**Say:**
> "For someone who leaves, we suspend rather than delete. A suspended account
> keeps all of its data, cannot sign in by any method including Google, and can
> be reactivated in one click. Permanent deletion exists, but it is restricted to
> a single super administrator because it is irreversible."

### Shot 4.7 — Broadcast
**Do:** Open the broadcast composer. Type a short message. Close without sending.

**Say:**
> "Administrators can send one message to everyone in a workspace — useful for a
> maintenance window or a release."

### Shot 4.8 — Activity feed
**Do:** Open **Activity Feed** and scroll.

**Say:**
> "Everything that happened, in order, with who did it. This is the audit trail —
> and it is the fastest answer to 'when did this change, and who changed it?'"

---

## 6. Part 5 — The contact and waitlist features (10:30–11:45)

### Shot 5.1 — Contact form
**Do:** Go to **Contact**. Submit an empty field to show validation, then fill
it in properly.

**Say:**
> "The contact form writes straight to our database. Each field is validated
> individually, so you are told exactly what is wrong instead of being told the
> form failed."

### Shot 5.2 — Waitlist
**Do:** Go to **Waitlist**. Enter an address. Show the response.

**Say:**
> "The waitlist is the one I would point at. It does not just store an email — it
> calculates a real queue position based on when people actually joined, and
> issues a referral code. And if you submit the same address twice, it returns
> your original position rather than letting you jump the queue by re-submitting."

> **Tip:** if you have already joined with an address, submitting it again is the
> best demonstration of that duplicate handling.

---

## 7. Part 6 — Closing (11:45–12:30)

### Shot 6.1 — The architecture, in one diagram
**Do:** Show a simple diagram — browser, React frontend, Express API, Supabase
PostgreSQL, Cloudinary. Narrate over it.

**Say:**
> "To summarise how it fits together: a React frontend deployed on Vercel, an
> Express API also on Vercel, a Supabase PostgreSQL database in the same region,
> and Cloudinary for media.
> Every request is authenticated with a signed token, and every permission check
> happens on the server. Hiding a button in the interface is never treated as
> access control."

### Shot 6.2 — Close
**Do:** Return to the home page.

**Say:**
> "That is Suprema — from the public site, through sign-in, into day-to-day task
> management, and the administration behind it. Thank you."

---

## 8. Optional: the 90-second version

If you need something short, cut these shots in this order:

| Shot | Content | Length |
| --- | --- | --- |
| 1.1 | Home page | 10s |
| 3.4 | Tasks board | 15s |
| 3.5 | Drag a card | 10s |
| 3.6 | Filters | 15s |
| 3.9 | Calendar | 10s |
| 3.10 | Analytics | 15s |
| 5.2 | Waitlist queue position | 15s |

Narrate continuously across them — do not pause between cuts.

---

## 9. Recording and editing notes

- **Never show a password being typed.** Type it into a password field only when
  it is masked, and never display credentials in a file or spreadsheet on screen.
- **Pan, do not zoom,** unless you are drawing attention to one control.
- **Narration first, then actions.** Record the voice separately if the mouse
  work makes you rusty — it is much easier to re-record one line than a whole take.
- **Captions matter.** Add hard captions. Many viewers watch with sound off.
- **Cut dead air.** Pause to think and it looks like a mistake.
- **Show real outcomes, not placeholders.** "Three tasks overdue" is credible;
  an empty board is not.
- **Mention the database caveat once**, briefly, in part 4. It demonstrates you
  understand the system's real constraints rather than hiding them.

## 10. Shot checklist

Use this to confirm nothing was missed before you stop recording.

- [ ] Database confirmed awake **before** recording
- [ ] Home, pricing toggle, changelog
- [ ] Google sign-in completes on camera
- [ ] Staff login page shown as a separate door
- [ ] Overview and Ctrl + K search
- [ ] Projects, Kanban, drag a card
- [ ] List view and filters, including Reset
- [ ] Task drawer: subtasks, comments, attachments
- [ ] Time tracker showing over-estimate
- [ ] Calendar with an overdue task
- [ ] Analytics including workload table
- [ ] Teams and the ownership rule
- [ ] Profile and avatar
- [ ] Staff overview with system health
- [ ] User management: search, role change, password reset, suspend
- [ ] Activity feed
- [ ] Contact validation, then waitlist position
- [ ] Architecture summary and close
- [ ] No password ever visible on screen