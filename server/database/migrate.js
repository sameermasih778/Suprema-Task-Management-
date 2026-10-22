/**
 * Additive, idempotent schema migrations - PostgreSQL edition.
 *
 * schema.sql is the source of truth for a FRESH database (`npm run db:init`
 * drops and recreates everything, so it always picks up the current schema).
 * But databases that were created BEFORE a schema.sql change keep the old
 * definition, and there is no automatic way to notice that.
 *
 * Each migration here must be:
 *   - IDEMPOTENT  : safe to run on every boot, no-ops when already applied
 *   - NON-DESTRUCTIVE : never drops or rewrites VALID data. It may repair data
 *                      that is already corrupt, but never intentionally valid rows.
 *
 * A migration that cannot be applied safely must not be destructive - fail
 * loudly with a manual fix instead.
 *
 * Converting from MySQL meant these helpers:
 *   SHOW COLUMNS FROM t LIKE 'c'   -> columnExists()
 *   SHOW TABLES LIKE 't'           -> tableExists()
 *   SHOW INDEX FROM t ...          -> indexExists()
 *   information_schema.statistics  -> indexExists() (pg_indexes)
 *   DATABASE()                    -> the 'public' schema
 *   ALTER TABLE t ADD COLUMN c ... AFTER d  ->  (no AFTER in PostgreSQL)
 *   ALTER TABLE t ADD INDEX n (c)  -> CREATE INDEX IF NOT EXISTS n ON t (c)
 *   ALTER TABLE t ADD UNIQUE KEY n (c) -> ADD CONSTRAINT n UNIQUE (c)
 *   ALTER TABLE t MODIFY c ENUM(..)-> drop + re-add the CHECK constraint
 */

/* ────────────────────────── helpers ────────────────────────── */

/**
 * Read the rows out of a query result.
 *
 * The engine has to work with two clients: the mysql2-shaped pool from
 * config/db.js (which answers [rows, fields]) and a raw node-postgres client
 * (which answers { rows, rowCount }) - the test harness passes the latter.
 * Accepting both keeps this file independent of which one it is handed.
 */
const rowsOf = (result) => {
  if (Array.isArray(result)) return result[0] || [];
  return (result && result.rows) || [];
};

/** How many rows a write touched, from either shape. */
const affectedOf = (result) => {
  if (Array.isArray(result)) {
    const header = result[0] || {};
    return header.affectedRows !== undefined ? header.affectedRows : 0;
  }
  return (result && result.rowCount) || 0;
};

async function tableExists(pool, table) {
  const rows = rowsOf(
    await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = $1`,
      [table]
    )
  );
  return rows.length > 0;
}

async function columnExists(pool, table, column) {
  const rows = rowsOf(
    await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
      [table, column]
    )
  );
  return rows.length > 0;
}

async function indexExists(pool, table, index) {
  const rows = rowsOf(
    await pool.query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2`,
      [table, index]
    )
  );
  return rows.length > 0;
}

async function constraintExists(pool, table, constraint) {
  const rows = rowsOf(
    await pool.query(
      `SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = current_schema() AND t.relname = $1 AND c.conname = $2`,
      [table, constraint]
    )
  );
  return rows.length > 0;
}

/**
 * Re-point a CHECK constraint at a new set of allowed values.
 *
 * The column used to be a MySQL ENUM; in PostgreSQL it is TEXT plus a CHECK
 * constraint, so "adding a value" means dropping the old constraint and
 * adding one that allows the new value too.
 */
async function replaceCheck(pool, table, column, constraint, values) {
  const list = values.map((v) => `'${v}'`).join(', ');
  const existing = await constraintExists(pool, table, constraint);
  if (existing) {
    const rows = rowsOf(
      await pool.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = $1 AND connamespace = current_schema()::regnamespace`,
        [constraint]
      )
    );
    const hasAll = values.every((v) => String(rows[0]?.def || '').includes(`'${v}'`));
    if (hasAll) return false;
  }

  // Drop and re-add in ONE statement. It takes an ACCESS EXCLUSIVE lock on
  // the table, so two serverless instances booting at the same time are
  // serialised: the second one waits, then redoes the same drop+add and
  // finishes with the constraint in place. Done as two separate statements,
  // the second instance could drop the constraint the first one had just
  // added and then fail to re-add it.
  await pool.query(
    `ALTER TABLE ${table}
       DROP CONSTRAINT IF EXISTS ${constraint},
       ADD CONSTRAINT ${constraint} CHECK (${column} IN (${list}))`
  );
  return true;
}

/* ────────────────────────── migrations ────────────────────────── */

const migrations = [
  {
    // users.role must include 'developer'.
    // Without this, assigning the developer role fails and the developer
    // portal cannot be used at all.
    name: '001-users-role-enum-includes-developer',
    async up(pool) {
      if (!(await tableExists(pool, 'users'))) {
        return { status: 'skipped', detail: 'users table not found - run `npm run db:init`' };
      }

      const changed = await replaceCheck(
        pool,
        'users',
        'role',
        'chk_users_role',
        ['super_admin', 'admin', 'developer', 'member', 'viewer']
      );

      return changed
        ? { status: 'applied', detail: 'users.role now allows developer' }
        : { status: 'current', detail: 'users.role already allows developer' };
    }
  },

  {
    // Repair users whose role was silently blanked.
    //
    // The old MySQL server ran WITHOUT STRICT_TRANS_TABLES, so an unknown
    // role was coerced to '' instead of raising an error - and a blank role
    // is invalid in every code path: authorizeRoles denies it, the sidebar
    // treats it as a non-staff user, and RoleBadge falls back to "Viewer".
    // Resetting to the schema default ('member') is the safe repair.
    name: '002-repair-blank-user-roles',
    async up(pool) {
      if (!(await tableExists(pool, 'users'))) {
        return { status: 'skipped', detail: 'users table not found - run `npm run db:init`' };
      }

      const rows = rowsOf(
        await pool.query(
          "SELECT id, email FROM users WHERE role IS NULL OR role = ''"
        )
      );
      if (rows.length === 0) {
        return { status: 'current', detail: 'no blank roles found' };
      }

      await pool.query(
        "UPDATE users SET role = 'member' WHERE role IS NULL OR role = ''"
      );

      return {
        status: 'applied',
        detail: `reset ${rows.length} blank role(s) to 'member': ${rows.map((r) => r.email).join(', ')}`
      };
    }
  },

  {
    // notifications.type needs an 'announcement' value (and later
    // 'invitation'). The admin broadcast endpoint and the workspace
    // invitation flow both write those types, and the old MySQL server
    // silently coerced an unknown type to '' instead of erroring.
    name: '003-notifications-type-enum-includes-announcement',
    async up(pool) {
      if (!(await tableExists(pool, 'notifications'))) {
        return { status: 'skipped', detail: 'notifications table not found - run `npm run db:init`' };
      }

      const changed = await replaceCheck(
        pool,
        'notifications',
        'type',
        'chk_notifications_type',
        ['info', 'task_assigned', 'mention', 'system', 'announcement', 'invitation']
      );

      return changed
        ? { status: 'applied', detail: 'notifications.type now allows announcement + invitation' }
        : { status: 'current', detail: 'notifications.type already allows announcement' };
    }
  },

  {
    // teams.created_by - who created each team.
    //
    // Without it there is no ownership record, so every authenticated user
    // could add/remove/delete members on ANY team. This column lets a member
    // manage only the teams they created, while staff can manage any.
    //
    // Existing teams are backfilled from their first team member: createTeam
    // auto-inserts the creator as a leader immediately, so the earliest
    // (joined_at, id) is the creator. Teams with no members keep NULL, which
    // safely means "only staff can manage".
    name: '005-teams-created-by',
    async up(pool) {
      const detailParts = [];
      let touched = false;

      if (!(await columnExists(pool, 'teams', 'created_by'))) {
        await pool.query('ALTER TABLE teams ADD COLUMN created_by INT DEFAULT NULL');
        detailParts.push('added teams.created_by column');
        touched = true;
      }

      if (!(await indexExists(pool, 'teams', 'idx_teams_created_by'))) {
        await pool.query('CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams (created_by)');
        detailParts.push('added index idx_teams_created_by');
        touched = true;
      }

      const backfilled = affectedOf(
        await pool.query(
          `UPDATE teams t
           SET created_by = (
             SELECT tm.user_id FROM team_members tm
             WHERE tm.team_id = t.id
             ORDER BY tm.joined_at ASC, tm.id ASC
             LIMIT 1
           )
           WHERE t.created_by IS NULL
             AND EXISTS (SELECT 1 FROM team_members tm2 WHERE tm2.team_id = t.id)`
        )
      );
      if (backfilled > 0) {
        detailParts.push(`backfilled creator on ${backfilled} team(s)`);
        touched = true;
      }

      if (!touched) {
        return { status: 'current', detail: 'teams.created_by already present' };
      }
      return { status: 'applied', detail: detailParts.join('; ') };
    }
  },

  {
    // Marketing tables (Milestone 6) - the public Contact / Waitlist /
    // Changelog / Pricing endpoints.
    //
    // These tables were created directly during development, so the only thing
    // a migration can still add is the INTEGRITY GUARANTEE the app relies on:
    // one row per waitlist email. Without a UNIQUE index, two concurrent
    // requests for the same address could both pass the "already registered?"
    // check and insert duplicates, which would hand two people the same queue
    // position. Adding the index is skipped (with a warning) if duplicates
    // already exist, because fixing data is a manual decision.
    name: '006-marketing-tables',
    async up(pool) {
      const detail = [];
      let touched = false;

      const TABLES = [
        `CREATE TABLE IF NOT EXISTS contact_messages (
            id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL,
            subject VARCHAR(200) DEFAULT 'Website Inquiry',
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unread'
                CONSTRAINT chk_contact_status CHECK (status IN ('unread','read','replied')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`,

        `CREATE TABLE IF NOT EXISTS waitlist_leads (
            id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            email VARCHAR(150) NOT NULL,
            queue_position INT DEFAULT NULL,
            referral_code VARCHAR(50) DEFAULT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CONSTRAINT chk_waitlist_status CHECK (status IN ('pending','invited','active')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`,

        `CREATE TABLE IF NOT EXISTS changelogs (
            id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            tag_id VARCHAR(100) NOT NULL,
            date VARCHAR(50) NOT NULL,
            badge VARCHAR(50) DEFAULT 'New',
            badge_color VARCHAR(50) DEFAULT 'text-emerald-400',
            title VARCHAR(255) NOT NULL,
            description TEXT,
            sub_item_title VARCHAR(255) DEFAULT NULL,
            sub_item_description TEXT,
            tag VARCHAR(100) DEFAULT NULL,
            banner_title VARCHAR(255) DEFAULT NULL,
            bullets JSONB DEFAULT NULL,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`,

        `CREATE TABLE IF NOT EXISTS pricing_plans (
            id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            plan_id VARCHAR(50) NOT NULL,
            name VARCHAR(100) NOT NULL,
            price_monthly VARCHAR(50) DEFAULT NULL,
            price_yearly VARCHAR(50) DEFAULT NULL,
            period VARCHAR(50) DEFAULT 'per user / month',
            subtext VARCHAR(100) DEFAULT NULL,
            popular BOOLEAN DEFAULT FALSE,
            popular_badge VARCHAR(50) DEFAULT NULL,
            has_toggle BOOLEAN DEFAULT TRUE,
            btn_variant VARCHAR(50) DEFAULT 'dark',
            btn_text VARCHAR(50) DEFAULT 'Get Started',
            features JSONB DEFAULT NULL,
            sort_order INT DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
      ];

      for (const ddl of TABLES) {
        await pool.query(ddl);
      }

      // Unique email on the waitlist, but only when the data allows it.
      const dupes = rowsOf(
        await pool.query(
          'SELECT email, COUNT(*) n FROM waitlist_leads GROUP BY email HAVING COUNT(*) > 1'
        )
      );
      if (dupes.length > 0) {
        return {
          status: 'skipped',
          detail:
            `waitlist_leads contains ${dupes.length} duplicate email(s), so the UNIQUE ` +
            'constraint was not added. De-duplicate the table and re-run to enforce it.'
        };
      }

      if (!(await indexExists(pool, 'waitlist_leads', 'uq_waitlist_email'))) {
        await pool.query(
          'ALTER TABLE waitlist_leads ADD CONSTRAINT uq_waitlist_email UNIQUE (email)'
        );
        detail.push('added UNIQUE constraint on waitlist_leads.email');
        touched = true;
      }

      if (!touched) {
        return { status: 'current', detail: 'marketing tables present, waitlist email already unique' };
      }
      return { status: 'applied', detail: detail.join('; ') };
    }
  },

  {
    // changelogs.release_date - a REAL date column for ordering.
    //
    // The table stores `date` as a display string ('Oct 12, 2024'). Sorting
    // lexicographically puts 'Sep 15, 2024' after 'Oct 12, 2024', so the
    // changelog rendered oldest-first. Adding a proper DATE column and
    // backfilling it from that string fixes the ordering without changing what
    // the page displays.
    name: '007-changelog-release-date',
    async up(pool) {
      const detail = [];
      let touched = false;

      if (!(await tableExists(pool, 'changelogs'))) {
        return { status: 'skipped', detail: 'changelogs table not found - run `npm run db:init`' };
      }

      if (!(await columnExists(pool, 'changelogs', 'release_date'))) {
        await pool.query('ALTER TABLE changelogs ADD COLUMN release_date DATE DEFAULT NULL');
        // Mon DD, YYYY - the abbreviated month name, day and 4-digit year.
        const backfilled = affectedOf(
          await pool.query(
            `UPDATE changelogs
             SET release_date = TO_DATE(date, 'Mon DD, YYYY')
             WHERE release_date IS NULL AND date IS NOT NULL`
          )
        );
        if (!(await indexExists(pool, 'changelogs', 'idx_changelog_release_date'))) {
          await pool.query(
            'CREATE INDEX IF NOT EXISTS idx_changelog_release_date ON changelogs (release_date)'
          );
        }
        detail.push(`added changelogs.release_date, backfilled ${backfilled} row(s)`);
        touched = true;
      }

      // Keep parity with schema.sql: one changelog row per tag.
      const dupes = rowsOf(
        await pool.query(
          'SELECT tag_id, COUNT(*) n FROM changelogs GROUP BY tag_id HAVING COUNT(*) > 1'
        )
      );
      if (dupes.length === 0) {
        if (!(await indexExists(pool, 'changelogs', 'uq_changelog_tag'))) {
          await pool.query(
            'ALTER TABLE changelogs ADD CONSTRAINT uq_changelog_tag UNIQUE (tag_id)'
          );
          detail.push('added UNIQUE constraint on changelogs.tag_id');
          touched = true;
        }
      }

      if (!touched) {
        return { status: 'current', detail: 'changelog release_date + unique tag already present' };
      }
      return { status: 'applied', detail: detail.join('; ') };
    }
  },

  /**
   * Self-service password resets.
   *
   * Tokens are stored as SHA-256 hashes, never in plaintext: a leaked database
   * must not hand an attacker working reset links. `used_at` lets a token be
   * consumed exactly once, and the index on user_id keeps cleanup cheap.
   */
  {
    name: '008-password-reset-tokens',
    async up(pool) {
      const detail = [];
      let touched = false;

      if (!(await tableExists(pool, 'password_reset_tokens'))) {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS password_reset_tokens (
             id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
             user_id INT NOT NULL,
             token_hash CHAR(64) NOT NULL,
             expires_at TIMESTAMPTZ NOT NULL,
             used_at TIMESTAMPTZ DEFAULT NULL,
             created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
             FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
             CONSTRAINT uq_password_reset_token UNIQUE (token_hash)
           )`
        );
        await pool.query(
          'CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id)'
        );
        await pool.query(
          'CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens (expires_at)'
        );
        detail.push('created password_reset_tokens');
        touched = true;
      }

      // Clear out anything already dead so the table never accumulates history.
      const purged = affectedOf(
        await pool.query(
          'DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL'
        )
      );
      if (purged > 0) {
        detail.push(`purged ${purged} spent/expired token(s)`);
        touched = true;
      }

      if (!touched) {
        return { status: 'current', detail: 'password_reset_tokens already present and clean' };
      }
      return { status: 'applied', detail: detail.join('; ') };
    }
  },

  {
    /**
     * blogs table & columns schema synchronization.
     *
     * Ensures all fields expected by Blog CMS (status, published_at, updated_at,
     * content, cover_image, tags, etc.) exist on the blogs table, and backfills
     * legacy rows so they immediately appear in the admin CMS as published posts.
     */
    name: '009-blogs-table-and-schema',
    async up(pool) {
      const detail = [];

      if (!(await tableExists(pool, 'blogs'))) {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS blogs (
             id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
             title VARCHAR(255) NOT NULL,
             slug VARCHAR(255) NOT NULL,
             banner_title VARCHAR(255) DEFAULT NULL,
             excerpt TEXT,
             content TEXT,
             sections JSONB DEFAULT NULL,
             category VARCHAR(100) DEFAULT NULL,
             category_color VARCHAR(50) DEFAULT 'text-emerald-400',
             category_bg VARCHAR(100) DEFAULT 'bg-emerald-500/10 border-emerald-500/20',
             date VARCHAR(50) DEFAULT NULL,
             author_name VARCHAR(100) DEFAULT NULL,
             author_role VARCHAR(100) DEFAULT NULL,
             author_handle VARCHAR(100) DEFAULT NULL,
             author_bio TEXT DEFAULT NULL,
             author_avatar VARCHAR(500) DEFAULT NULL,
             cover_image VARCHAR(500) DEFAULT NULL,
             tags JSONB DEFAULT NULL,
             featured BOOLEAN NOT NULL DEFAULT FALSE,
             read_time VARCHAR(50) DEFAULT '5 min read',
             status TEXT NOT NULL DEFAULT 'published'
                 CONSTRAINT chk_blogs_status CHECK (status IN ('draft','published','archived')),
             published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
             created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
             updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
           )`
        );
        await pool.query('CREATE INDEX IF NOT EXISTS idx_blog_status ON blogs (status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_blog_category ON blogs (category)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_blog_featured ON blogs (featured)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_blog_published ON blogs (published_at)');
        await pool.query(
          'ALTER TABLE blogs ADD CONSTRAINT uq_blog_slug UNIQUE (slug)'
        );
        detail.push('created blogs table');
      } else {
        const toAdd = [];
        if (!(await columnExists(pool, 'blogs', 'status'))) {
          toAdd.push("status TEXT NOT NULL DEFAULT 'published'");
        }
        if (!(await columnExists(pool, 'blogs', 'published_at'))) {
          toAdd.push('published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');
        }
        if (!(await columnExists(pool, 'blogs', 'updated_at'))) {
          toAdd.push('updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');
        }
        if (!(await columnExists(pool, 'blogs', 'content'))) {
          toAdd.push('content TEXT DEFAULT NULL');
        }
        if (!(await columnExists(pool, 'blogs', 'cover_image'))) {
          toAdd.push('cover_image VARCHAR(500) DEFAULT NULL');
        }
        if (!(await columnExists(pool, 'blogs', 'tags'))) {
          toAdd.push('tags JSONB DEFAULT NULL');
        }
        if (!(await columnExists(pool, 'blogs', 'banner_title'))) {
          toAdd.push('banner_title VARCHAR(255) DEFAULT NULL');
        }
        if (!(await columnExists(pool, 'blogs', 'category_color'))) {
          toAdd.push("category_color VARCHAR(50) DEFAULT 'text-emerald-400'");
        }
        if (!(await columnExists(pool, 'blogs', 'category_bg'))) {
          toAdd.push("category_bg VARCHAR(100) DEFAULT 'bg-emerald-500/10 border-emerald-500/20'");
        }
        if (!(await columnExists(pool, 'blogs', 'author_handle'))) {
          toAdd.push('author_handle VARCHAR(100) DEFAULT NULL');
        }
        if (!(await columnExists(pool, 'blogs', 'author_bio'))) {
          toAdd.push('author_bio TEXT DEFAULT NULL');
        }
        if (!(await columnExists(pool, 'blogs', 'date'))) {
          toAdd.push('date VARCHAR(50) DEFAULT NULL');
        }
        if (!(await columnExists(pool, 'blogs', 'sections'))) {
          toAdd.push('sections JSONB DEFAULT NULL');
        }

        if (toAdd.length > 0) {
          await pool.query(`ALTER TABLE blogs ADD COLUMN ${toAdd.join(', ')}`);
          detail.push(`added ${toAdd.length} missing column(s)`);
        }
      }

      // Backfill existing rows with content and status if missing
      try {
        const rows = rowsOf(
          await pool.query('SELECT id, sections, content, status FROM blogs')
        );
        let backfilled = 0;
        for (const row of rows) {
          let updateContent = row.content;
          let updateStatus = row.status || 'published';
          let changed = false;

          if (!row.content && row.sections) {
            try {
              const parsed = typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections;
              if (Array.isArray(parsed) && parsed.length > 0) {
                updateContent = parsed
                  .map((s) => `## ${s.heading || 'Section'}\n\n${s.content || ''}`)
                  .join('\n\n');
                changed = true;
              }
            } catch (_) {}
          }

          if (!row.status) {
            updateStatus = 'published';
            changed = true;
          }

          if (changed) {
            await pool.query(
              'UPDATE blogs SET content = $1, status = $2 WHERE id = $3',
              [updateContent, updateStatus, row.id]
            );
            backfilled++;
          }
        }

        if (backfilled > 0) {
          detail.push(`backfilled ${backfilled} blog row(s)`);
        }
      } catch (err) {
        detail.push(`backfill notice: ${err.message}`);
      }

      if (detail.length === 0) {
        return { status: 'current', detail: 'blogs table up to date' };
      }
      return { status: 'applied', detail: detail.join('; ') };
    }
  },

  {
    // workspace_invitations - pending requests to join a workspace.
    //
    // Until this table existed, "Invite Collaborator" inserted straight into
    // workspace_members: the person became a member immediately and silently,
    // with no way to accept or decline and no notification. A workspace
    // invitation is a request, and the request needs somewhere to live.
    name: '010-workspace-invitations-table',
    async up(pool) {
      if (await tableExists(pool, 'workspace_invitations')) {
        return { status: 'current', detail: 'workspace_invitations table already exists' };
      }

      await pool.query(
        `CREATE TABLE IF NOT EXISTS workspace_invitations (
           id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
           workspace_id INT NOT NULL,
           user_id INT NOT NULL,
           email VARCHAR(150) NOT NULL,
           role TEXT NOT NULL DEFAULT 'member'
               CONSTRAINT chk_wi_role CHECK (role IN ('owner','admin','member','guest')),
           invited_by INT NOT NULL,
           status TEXT NOT NULL DEFAULT 'pending'
               CONSTRAINT chk_wi_status CHECK (status IN ('pending','accepted','rejected')),
           created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           responded_at TIMESTAMPTZ DEFAULT NULL,
           FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
           FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
         )`
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_wi_workspace ON workspace_invitations (workspace_id)'
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_wi_user ON workspace_invitations (user_id)'
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_wi_status ON workspace_invitations (status)'
      );

      return { status: 'applied', detail: 'created workspace_invitations table' };
    }
  },

  {
    // workspace_invitations.role needs an 'owner' value: when an admin creates
    // a workspace for a named colleague, that colleague is invited as the
    // owner and only becomes a member by accepting.
    name: '011-workspace-invitations-role-enum-includes-owner',
    async up(pool) {
      if (!(await tableExists(pool, 'workspace_invitations'))) {
        return { status: 'skipped', detail: 'workspace_invitations not found - run `npm run db:init`' };
      }

      const changed = await replaceCheck(
        pool,
        'workspace_invitations',
        'role',
        'chk_wi_role',
        ['owner', 'admin', 'member', 'guest']
      );

      return changed
        ? { status: 'applied', detail: 'workspace_invitations.role now allows owner' }
        : { status: 'current', detail: 'workspace_invitations.role already allows owner' };
    }
  },

  {
    // workspaces.status - so a workspace can be archived instead of deleted.
    //
    // Deleting a workspace cascades through members, teams, projects, tasks,
    // comments, attachments and the audit trail. Archiving freezes it instead:
    // it leaves the switcher, every row is kept, and it can be restored.
    name: '012-workspaces-status-column',
    async up(pool) {
      if (!(await tableExists(pool, 'workspaces'))) {
        return { status: 'skipped', detail: 'workspaces table not found - run `npm run db:init`' };
      }

      if (!(await columnExists(pool, 'workspaces', 'status'))) {
        await pool.query(
          "ALTER TABLE workspaces ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
        );
        await pool.query(
          `ALTER TABLE workspaces ADD CONSTRAINT chk_workspaces_status CHECK (status IN ('active','archived'))`
        );
        await pool.query(
          'CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces (status)'
        );
        return { status: 'applied', detail: 'added workspaces.status (active/archived)' };
      }

      const changed = await replaceCheck(
        pool,
        'workspaces',
        'status',
        'chk_workspaces_status',
        ['active', 'archived']
      );

      return changed
        ? { status: 'applied', detail: 'workspaces.status now allows archived' }
        : { status: 'current', detail: 'workspaces.status already present' };
    }
  }
];

/**
 * Run every pending migration against the given pool.
 * Never throws - a failed migration is logged and the server still boots.
 */
async function runMigrations(pool) {
  for (const migration of migrations) {
    try {
      const result = await migration.up(pool);

      if (result.status === 'applied') {
        console.log(`dY>��,?  Migration applied: ${migration.name}`);
        console.log(`   ${result.detail}`);
      } else if (result.status === 'skipped') {
        console.warn(`�s��,?  Migration skipped: ${migration.name} - ${result.detail}`);
      }
    } catch (error) {
      console.error(`�?O Migration failed: ${migration.name}`);
      console.error(`   ${error.message}`);
      console.error('   Server will keep running, but this feature may misbehave.');
    }
  }
}

module.exports = { runMigrations, migrations };
