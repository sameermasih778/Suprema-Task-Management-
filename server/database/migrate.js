/**
 * Additive, idempotent schema migrations.
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
 */

const migrations = [
  {
    // users.role must include 'developer'.
    // Without this, UPDATE users SET role = 'developer' fails with
    // "Data truncated for column 'role'", which breaks both the admin panel's
    // role dropdown and anyone logging into the developer portal.
    name: '001-users-role-enum-includes-developer',
    async up(pool) {
      const [rows] = await pool.query("SHOW COLUMNS FROM users LIKE 'role'");
      if (rows.length === 0) {
        return { status: 'skipped', detail: 'users.role column not found - run `npm run db:init`' };
      }

      const current = rows[0].Type;
      if (current.includes("'developer'")) {
        return { status: 'current', detail: current };
      }

      await pool.query(
        "ALTER TABLE users MODIFY role ENUM('super_admin','admin','developer','member','viewer') NOT NULL DEFAULT 'member'"
      );

      return { status: 'applied', detail: `${current} -> enum('super_admin','admin','developer','member','viewer')` };
    }
  },

  {
    // Repair users whose role was silently blanked.
    //
    // This MySQL server runs WITHOUT STRICT_TRANS_TABLES, so before migration
    // 001 existed, `UPDATE users SET role = 'developer'` did not raise an
    // error - it coerced the unknown value to '' and wrote it. Such a row is
    // invalid in every code path: authorizeRoles denies it, the sidebar treats
    // it as a non-staff user, and RoleBadge falls back to "Viewer".
    //
    // Resetting to the schema default ('member') is the safe repair - an empty
    // role is never an intentional state.
    name: '002-repair-blank-user-roles',
    async up(pool) {
      const [rows] = await pool.query(
        "SELECT id, email FROM users WHERE role IS NULL OR role = ''"
      );

      if (rows.length === 0) {
        return { status: 'current', detail: 'no blank roles found' };
      }

      const [result] = await pool.query(
        "UPDATE users SET role = 'member' WHERE role IS NULL OR role = ''"
      );

      return {
        status: 'applied',
        detail: `reset ${result.affectedRows} blank role(s) to 'member': ${rows.map((r) => r.email).join(', ')}`
      };
    }
  },

  {
    // notifications.type needs an 'announcement' value.
    //
    // The admin broadcast endpoint sends type='announcement', but the ENUM only
    // had info/task_assigned/mention/system. Because this server runs without
    // STRICT_TRANS_TABLES, MySQL silently coerced the unknown value to ''
    // instead of raising an error - so every broadcast was stored with a blank
    // type and the header dropdown could not style announcements.
    name: '003-notifications-type-enum-includes-announcement',
    async up(pool) {
      const [rows] = await pool.query("SHOW COLUMNS FROM notifications LIKE 'type'");
      if (rows.length === 0) {
        return { status: 'skipped', detail: 'notifications.type column not found - run `npm run db:init`' };
      }

      const current = rows[0].Type;
      if (current.includes("'announcement'")) {
        return { status: 'current', detail: current };
      }

      await pool.query(
        "ALTER TABLE notifications MODIFY type ENUM('info','task_assigned','mention','system','announcement') NOT NULL DEFAULT 'info'"
      );

      return { status: 'applied', detail: `${current} -> + 'announcement'` };
    }
  },

  {
    // teams.created_by - who created each team.
    //
    // Without it there is no ownership record, so every authenticated user
    // could add/remove/delete members on ANY team. This column lets a member
    // manage only the teams they created, while staff can still manage any.
    //
    // Existing teams are backfilled from their first team member: createTeam
    // auto-inserts the creator as a leader immediately, so the earliest
    // (joined_at, id) is the creator. Teams with no members keep NULL, which
    // safely means "only staff can manage".
    name: '005-teams-created-by',
    async up(pool) {
      const detailParts = [];
      let touched = false;

      const [cols] = await pool.query("SHOW COLUMNS FROM teams LIKE 'created_by'");
      if (cols.length === 0) {
        await pool.query(
          'ALTER TABLE teams ADD COLUMN created_by INT DEFAULT NULL AFTER description'
        );
        detailParts.push('added teams.created_by column');
        touched = true;
      }

      const [idx] = await pool.query(
        "SHOW INDEX FROM teams WHERE Key_name = 'idx_teams_created_by'"
      );
      if (idx.length === 0) {
        await pool.query('CREATE INDEX idx_teams_created_by ON teams (created_by)');
        detailParts.push('added index idx_teams_created_by');
        touched = true;
      }

      const [backfill] = await pool.query(
        `UPDATE teams t
         SET t.created_by = (
           SELECT tm.user_id FROM team_members tm
           WHERE tm.team_id = t.id
           ORDER BY tm.joined_at ASC, tm.id ASC
           LIMIT 1
         )
         WHERE t.created_by IS NULL
           AND EXISTS (SELECT 1 FROM team_members tm2 WHERE tm2.team_id = t.id)`
      );
      if (backfill.affectedRows > 0) {
        detailParts.push(`backfilled creator on ${backfill.affectedRows} team(s)`);
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
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL,
            subject VARCHAR(200) DEFAULT 'Website Inquiry',
            message TEXT NOT NULL,
            status ENUM('unread','read','replied') NOT NULL DEFAULT 'unread',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_contact_status (status),
            INDEX idx_contact_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

        `CREATE TABLE IF NOT EXISTS waitlist_leads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(150) NOT NULL,
            queue_position INT DEFAULT NULL,
            referral_code VARCHAR(50) DEFAULT NULL,
            status ENUM('pending','invited','active') NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_waitlist_position (queue_position)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

        `CREATE TABLE IF NOT EXISTS changelogs (
            id INT AUTO_INCREMENT PRIMARY KEY,
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
            bullets JSON DEFAULT NULL,
            note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_changelog_badge (badge)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

        `CREATE TABLE IF NOT EXISTS pricing_plans (
            id INT AUTO_INCREMENT PRIMARY KEY,
            plan_id VARCHAR(50) NOT NULL,
            name VARCHAR(100) NOT NULL,
            price_monthly VARCHAR(50) DEFAULT NULL,
            price_yearly VARCHAR(50) DEFAULT NULL,
            period VARCHAR(50) DEFAULT 'per user / month',
            subtext VARCHAR(100) DEFAULT NULL,
            popular TINYINT(1) DEFAULT 0,
            popular_badge VARCHAR(50) DEFAULT NULL,
            has_toggle TINYINT(1) DEFAULT 1,
            btn_variant VARCHAR(50) DEFAULT 'dark',
            btn_text VARCHAR(50) DEFAULT 'Get Started',
            features JSON DEFAULT NULL,
            sort_order INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_plan_sort (sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      ];

      for (const ddl of TABLES) {
        await pool.query(ddl);
      }

      // Unique email on the waitlist, but only when the data allows it.
      const [dupes] = await pool.query(
        'SELECT email, COUNT(*) n FROM waitlist_leads GROUP BY email HAVING n > 1'
      );
      if (dupes.length > 0) {
        return {
          status: 'skipped',
          detail:
            `waitlist_leads contains ${dupes.length} duplicate email(s), so the UNIQUE ` +
            'index was not added. De-duplicate the table and re-run to enforce it.'
        };
      }

      const [indexes] = await pool.query(
        "SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'waitlist_leads' AND index_name = 'uq_waitlist_email'"
      );
      if (indexes[0].c === 0) {
        await pool.query('ALTER TABLE waitlist_leads ADD UNIQUE KEY uq_waitlist_email (email)');
        detail.push('added UNIQUE index on waitlist_leads.email');
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

      const [cols] = await pool.query(
        "SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'changelogs' AND column_name = 'release_date'"
      );

      if (cols[0].c === 0) {
        await pool.query('ALTER TABLE changelogs ADD COLUMN release_date DATE DEFAULT NULL AFTER tag_id');
        // %b = abbreviated month name, %d = day, %Y = 4-digit year.
        const [backfill] = await pool.query(
          `UPDATE changelogs
           SET release_date = STR_TO_DATE(date, '%b %d, %Y')
           WHERE release_date IS NULL`
        );
        const [indexes] = await pool.query(
          "SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'changelogs' AND index_name = 'idx_changelog_release_date'"
        );
        if (indexes[0].c === 0) {
          await pool.query('ALTER TABLE changelogs ADD INDEX idx_changelog_release_date (release_date)');
        }
        detail.push(`added changelogs.release_date, backfilled ${backfill.affectedRows} row(s)`);
        touched = true;
      }

      // Keep parity with schema.sql: one changelog row per tag.
      const [dupes] = await pool.query(
        'SELECT tag_id, COUNT(*) n FROM changelogs GROUP BY tag_id HAVING n > 1'
      );
      if (dupes.length === 0) {
        const [existing] = await pool.query(
          "SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'changelogs' AND index_name = 'uq_changelog_tag'"
        );
        if (existing[0].c === 0) {
          await pool.query('ALTER TABLE changelogs ADD UNIQUE KEY uq_changelog_tag (tag_id)');
          detail.push('added UNIQUE index on changelogs.tag_id');
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

      const [tables] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_name = 'password_reset_tokens'`
      );

      if (tables[0].c === 0) {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS password_reset_tokens (
             id INT AUTO_INCREMENT PRIMARY KEY,
             user_id INT NOT NULL,
             token_hash CHAR(64) NOT NULL,
             expires_at DATETIME NOT NULL,
             used_at DATETIME DEFAULT NULL,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
             UNIQUE KEY uq_password_reset_token (token_hash),
             INDEX idx_password_reset_user (user_id),
             INDEX idx_password_reset_expiry (expires_at)
           ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );
        detail.push('created password_reset_tokens');
        touched = true;
      }

      // Clear out anything already dead so the table never accumulates history.
      const [purged] = await pool.query(
        'DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL'
      );
      if (purged.affectedRows > 0) {
        detail.push(`purged ${purged.affectedRows} spent/expired token(s)`);
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

      const [tables] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_name = 'blogs'`
      );

      if (tables[0].c === 0) {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS blogs (
             id INT AUTO_INCREMENT PRIMARY KEY,
             title VARCHAR(255) NOT NULL,
             slug VARCHAR(255) NOT NULL,
             banner_title VARCHAR(255) DEFAULT NULL,
             excerpt TEXT,
             content LONGTEXT,
             sections JSON DEFAULT NULL,
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
             tags JSON DEFAULT NULL,
             featured TINYINT(1) NOT NULL DEFAULT 0,
             read_time VARCHAR(50) DEFAULT '5 min read',
             status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
             published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
             UNIQUE KEY uq_blog_slug (slug),
             INDEX idx_blog_status (status),
             INDEX idx_blog_category (category),
             INDEX idx_blog_featured (featured),
             INDEX idx_blog_published (published_at)
           ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );
        detail.push('created blogs table');
      } else {
        const [columns] = await pool.query('SHOW COLUMNS FROM blogs');
        const colNames = columns.map((c) => c.Field);

        const toAdd = [];
        if (!colNames.includes('status')) {
          toAdd.push("ADD COLUMN status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published'");
        }
        if (!colNames.includes('published_at')) {
          toAdd.push('ADD COLUMN published_at DATETIME DEFAULT CURRENT_TIMESTAMP');
        }
        if (!colNames.includes('updated_at')) {
          toAdd.push('ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
        }
        if (!colNames.includes('content')) {
          toAdd.push('ADD COLUMN content LONGTEXT DEFAULT NULL');
        }
        if (!colNames.includes('cover_image')) {
          toAdd.push('ADD COLUMN cover_image VARCHAR(500) DEFAULT NULL');
        }
        if (!colNames.includes('tags')) {
          toAdd.push('ADD COLUMN tags JSON DEFAULT NULL');
        }
        if (!colNames.includes('banner_title')) {
          toAdd.push('ADD COLUMN banner_title VARCHAR(255) DEFAULT NULL');
        }
        if (!colNames.includes('category_color')) {
          toAdd.push("ADD COLUMN category_color VARCHAR(50) DEFAULT 'text-emerald-400'");
        }
        if (!colNames.includes('category_bg')) {
          toAdd.push("ADD COLUMN category_bg VARCHAR(100) DEFAULT 'bg-emerald-500/10 border-emerald-500/20'");
        }
        if (!colNames.includes('author_handle')) {
          toAdd.push('ADD COLUMN author_handle VARCHAR(100) DEFAULT NULL');
        }
        if (!colNames.includes('author_bio')) {
          toAdd.push('ADD COLUMN author_bio TEXT DEFAULT NULL');
        }
        if (!colNames.includes('date')) {
          toAdd.push('ADD COLUMN date VARCHAR(50) DEFAULT NULL');
        }
        if (!colNames.includes('sections')) {
          toAdd.push('ADD COLUMN sections JSON DEFAULT NULL');
        }

        if (toAdd.length > 0) {
          await pool.query(`ALTER TABLE blogs ${toAdd.join(', ')}`);
          detail.push(`added ${toAdd.length} missing column(s)`);
        }

        await pool.query("ALTER TABLE blogs MODIFY author_role VARCHAR(100) NULL DEFAULT 'Contributor'");
        await pool.query("ALTER TABLE blogs MODIFY date VARCHAR(50) NULL DEFAULT NULL");
        await pool.query("ALTER TABLE blogs MODIFY sections JSON NULL DEFAULT NULL");
      }

      // Backfill existing rows with content and status if missing
      try {
        const [rows] = await pool.query('SELECT id, sections, content, status, created_at FROM blogs');
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
              'UPDATE blogs SET content = ?, status = ? WHERE id = ?',
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
    name: '008-workspace-invitations-table',
    async up(pool) {
      const [rows] = await pool.query("SHOW TABLES LIKE 'workspace_invitations'");
      if (rows.length > 0) {
        return { status: 'current', detail: 'workspace_invitations table already exists' };
      }

      await pool.query(
        `CREATE TABLE IF NOT EXISTS workspace_invitations (
           id INT AUTO_INCREMENT PRIMARY KEY,
           workspace_id INT NOT NULL,
           user_id INT NOT NULL,
           email VARCHAR(150) NOT NULL,
           role ENUM('admin', 'member', 'guest') NOT NULL DEFAULT 'member',
           invited_by INT NOT NULL,
           status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           responded_at TIMESTAMP DEFAULT NULL,
           FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
           FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
           INDEX idx_wi_workspace (workspace_id),
           INDEX idx_wi_user (user_id),
           INDEX idx_wi_status (status)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );

      return { status: 'applied', detail: 'created workspace_invitations table' };
    }
  },

  {
    // notifications.type needs an 'invitation' value.
    //
    // Same reason as migration 003: this server runs without
    // STRICT_TRANS_TABLES, so an unknown type is silently coerced to '' and
    // the header dropdown cannot style it. An invitation notification is
    // distinct from a plain 'system' message - it is the one the invitee has
    // to act on.
    name: '009-notifications-type-enum-includes-invitation',
    async up(pool) {
      const [rows] = await pool.query("SHOW COLUMNS FROM notifications LIKE 'type'");
      if (rows.length === 0) {
        return { status: 'skipped', detail: 'notifications.type column not found - run `npm run db:init`' };
      }

      const current = rows[0].Type;
      if (current.includes("'invitation'")) {
        return { status: 'current', detail: current };
      }

      await pool.query(
        "ALTER TABLE notifications MODIFY type ENUM('info','task_assigned','mention','system','announcement','invitation') NOT NULL DEFAULT 'info'"
      );

      return { status: 'applied', detail: `${current} -> + 'invitation'` };
    }
  },

  {
    // workspaces.status - so a workspace can be archived instead of deleted.
    //
    // Deleting a workspace cascades through members, teams, projects, tasks,
    // comments, attachments and the audit trail. Archiving freezes it instead:
    // it leaves the switcher, every row is kept, and it can be restored.
    name: '010-workspaces-status-column',
    async up(pool) {
      const [cols] = await pool.query("SHOW COLUMNS FROM workspaces LIKE 'status'");
      if (cols.length > 0) {
        return { status: 'current', detail: 'workspaces.status already exists' };
      }

      const [table] = await pool.query("SHOW TABLES LIKE 'workspaces'");
      if (table.length === 0) {
        return { status: 'skipped', detail: 'workspaces table not found - run `npm run db:init`' };
      }

      await pool.query(
        "ALTER TABLE workspaces ADD COLUMN status ENUM('active', 'archived') NOT NULL DEFAULT 'active' AFTER plan"
      );
      await pool.query('CREATE INDEX idx_workspaces_status ON workspaces (status)');

      return { status: 'applied', detail: 'added workspaces.status (active/archived)' };
    }
  },

  {
    // workspace_invitations.role needs an 'owner' value.
    //
    // When an admin creates a workspace for a named colleague, that colleague
    // is invited as the owner and only becomes a member by accepting - so the
    // invitation has to be able to carry the 'owner' role.
    name: '011-workspace-invitations-role-enum-includes-owner',
    async up(pool) {
      const [rows] = await pool.query("SHOW COLUMNS FROM workspace_invitations LIKE 'role'");
      if (rows.length === 0) {
        return { status: 'skipped', detail: 'workspace_invitations.role not found - run `npm run db:init`' };
      }

      const current = rows[0].Type;
      if (current.includes("'owner'")) {
        return { status: 'current', detail: current };
      }

      await pool.query(
        "ALTER TABLE workspace_invitations MODIFY role ENUM('owner','admin','member','guest') NOT NULL DEFAULT 'member'"
      );

      return { status: 'applied', detail: `${current} -> + 'owner'` };
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
        console.log(`🛠️  Migration applied: ${migration.name}`);
        console.log(`   ${result.detail}`);
      } else if (result.status === 'skipped') {
        console.warn(`⚠️  Migration skipped: ${migration.name} - ${result.detail}`);
      }
    } catch (error) {
      console.error(`❌ Migration failed: ${migration.name}`);
      console.error(`   ${error.message}`);
      console.error('   Server will keep running, but this feature may misbehave.');
    }
  }
}

module.exports = { runMigrations, migrations };