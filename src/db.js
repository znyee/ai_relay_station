import { DatabaseSync } from "node:sqlite";
import { nowIso, randomId, safeJsonParse, truncate } from "./utils.js";

function parseRows(rows) {
  return rows.map((row) => ({
    ...row,
    allowedModels: safeJsonParse(row.allowed_models_json, []),
    changedFiles: safeJsonParse(row.changed_files_json, []),
    attachments: safeJsonParse(row.attachments_json, []),
    outputAttachments: safeJsonParse(row.output_attachments_json, []),
    canUseCode: Boolean(row.can_use_code),
    isAdmin: Boolean(row.is_admin),
    isPinned: Boolean(row.pinned_at),
    failedLoginAttempts: Number(row.failed_login_attempts || 0),
  }));
}

function parseRow(row) {
  if (!row) {
    return null;
  }

  const [parsed] = parseRows([row]);
  return parsed;
}

function parseAuditRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    eventType: row.event_type,
    reason: row.reason,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }));
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function createDatabase(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      repo_local_path TEXT,
      repo_default_branch TEXT NOT NULL DEFAULT 'main',
      chat_model TEXT NOT NULL,
      allowed_models_json TEXT NOT NULL DEFAULT '[]',
      can_use_code INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      last_login_ip TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_audit_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT NOT NULL,
      event_type TEXT NOT NULL,
      reason TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      pinned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS code_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      pinned_at TEXT,
      workspace_path TEXT,
      final_message TEXT,
      error_text TEXT,
      diff_text TEXT,
      diff_stat TEXT,
      git_status_text TEXT,
      changed_files_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      output_attachments_json TEXT NOT NULL DEFAULT '[]',
      command_preview TEXT,
      log_path TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "users", "can_use_code", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "failed_login_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "users", "locked_until", "TEXT");
  ensureColumn(db, "users", "last_login_at", "TEXT");
  ensureColumn(db, "users", "last_login_ip", "TEXT");
  ensureColumn(db, "sessions", "user_agent", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "sessions", "ip_address", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "sessions", "last_seen_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "chat_messages", "attachments_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "chat_conversations", "pinned_at", "TEXT");
  ensureColumn(db, "code_jobs", "pinned_at", "TEXT");
  ensureColumn(db, "code_jobs", "attachments_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "code_jobs", "output_attachments_json", "TEXT NOT NULL DEFAULT '[]'");

  const statements = {
    insertUser: db.prepare(`
      INSERT INTO users (
        id, username, password_hash, display_name, repo_url, repo_local_path,
        repo_default_branch, chat_model, allowed_models_json, can_use_code,
        is_admin, failed_login_attempts, locked_until, last_login_at, last_login_ip,
        created_at, updated_at
      )
      VALUES (
        @id, @username, @password_hash, @display_name, @repo_url, @repo_local_path,
        @repo_default_branch, @chat_model, @allowed_models_json, @can_use_code,
        @is_admin, 0, NULL, NULL, NULL, @created_at, @updated_at
      )
    `),
    updateUser: db.prepare(`
      UPDATE users
      SET
        password_hash = COALESCE(@password_hash, password_hash),
        display_name = @display_name,
        repo_url = @repo_url,
        repo_local_path = @repo_local_path,
        repo_default_branch = @repo_default_branch,
        chat_model = @chat_model,
        allowed_models_json = @allowed_models_json,
        can_use_code = @can_use_code,
        is_admin = @is_admin,
        updated_at = @updated_at
      WHERE id = @id
    `),
    updateUserLoginFailure: db.prepare(`
      UPDATE users
      SET
        failed_login_attempts = @failed_login_attempts,
        locked_until = @locked_until,
        updated_at = @updated_at
      WHERE id = @id
    `),
    updateUserLoginSuccess: db.prepare(`
      UPDATE users
      SET
        failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = @last_login_at,
        last_login_ip = @last_login_ip,
        updated_at = @updated_at
      WHERE id = @id
    `),
    getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
    getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    listUsers: db.prepare(`SELECT * FROM users ORDER BY created_at ASC`),
    deleteUser: db.prepare(`DELETE FROM users WHERE id = ?`),
    insertSession: db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent, ip_address, last_seen_at)
      VALUES (@id, @user_id, @expires_at, @created_at, @user_agent, @ip_address, @last_seen_at)
    `),
    getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
    touchSession: db.prepare(`
      UPDATE sessions
      SET last_seen_at = @last_seen_at, user_agent = @user_agent, ip_address = @ip_address
      WHERE id = @id
    `),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
    deleteExpiredSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),
    insertAuthAuditEvent: db.prepare(`
      INSERT INTO auth_audit_events (
        id, user_id, username, event_type, reason, ip_address, user_agent, created_at
      )
      VALUES (
        @id, @user_id, @username, @event_type, @reason, @ip_address, @user_agent, @created_at
      )
    `),
    listAuthAuditEvents: db.prepare(`
      SELECT *
      FROM auth_audit_events
      ORDER BY created_at DESC
      LIMIT ?
    `),
    listConversations: db.prepare(`
      SELECT *
      FROM chat_conversations
      WHERE user_id = ?
      ORDER BY
        CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END ASC,
        pinned_at DESC,
        updated_at DESC
    `),
    getConversation: db.prepare(`
      SELECT *
      FROM chat_conversations
      WHERE id = ? AND user_id = ?
    `),
    insertConversation: db.prepare(`
      INSERT INTO chat_conversations (id, user_id, title, created_at, updated_at)
      VALUES (@id, @user_id, @title, @created_at, @updated_at)
    `),
    updateConversationTitle: db.prepare(`
      UPDATE chat_conversations
      SET title = @title, updated_at = @updated_at
      WHERE id = @id
    `),
    updateConversationPinned: db.prepare(`
      UPDATE chat_conversations
      SET pinned_at = @pinned_at
      WHERE id = @id
    `),
    deleteConversation: db.prepare(`
      DELETE FROM chat_conversations
      WHERE id = @id AND user_id = @user_id
    `),
    touchConversation: db.prepare(`
      UPDATE chat_conversations
      SET updated_at = @updated_at
      WHERE id = @id
    `),
    listMessages: db.prepare(`
      SELECT *
      FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `),
    getMessage: db.prepare(`
      SELECT *
      FROM chat_messages
      WHERE id = ? AND conversation_id = ?
    `),
    insertMessage: db.prepare(`
      INSERT INTO chat_messages (id, conversation_id, role, content, model, attachments_json, created_at)
      VALUES (@id, @conversation_id, @role, @content, @model, @attachments_json, @created_at)
    `),
    listJobs: db.prepare(`
      SELECT *
      FROM code_jobs
      WHERE user_id = ?
      ORDER BY
        CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END ASC,
        pinned_at DESC,
        created_at DESC
    `),
    getJob: db.prepare(`
      SELECT *
      FROM code_jobs
      WHERE id = ? AND user_id = ?
    `),
    getJobForWorker: db.prepare(`SELECT * FROM code_jobs WHERE id = ?`),
    insertJob: db.prepare(`
      INSERT INTO code_jobs (
        id, user_id, prompt, status, branch_name, pinned_at, created_at, changed_files_json, attachments_json
      )
      VALUES (
        @id, @user_id, @prompt, @status, @branch_name, NULL, @created_at, '[]', @attachments_json
      )
    `),
    updateJobPinned: db.prepare(`
      UPDATE code_jobs
      SET pinned_at = @pinned_at
      WHERE id = @id
    `),
    deleteJob: db.prepare(`
      DELETE FROM code_jobs
      WHERE id = @id AND user_id = @user_id
    `),
    getNextPendingJob: db.prepare(`
      SELECT *
      FROM code_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `),
    markJobRunning: db.prepare(`
      UPDATE code_jobs
      SET
        status = 'running',
        started_at = @started_at,
        workspace_path = @workspace_path,
        log_path = @log_path,
        command_preview = @command_preview
      WHERE id = @id
    `),
    markJobCompleted: db.prepare(`
      UPDATE code_jobs
      SET
        status = 'completed',
        final_message = @final_message,
        diff_text = @diff_text,
        diff_stat = @diff_stat,
        git_status_text = @git_status_text,
        changed_files_json = @changed_files_json,
        output_attachments_json = @output_attachments_json,
        command_preview = @command_preview,
        log_path = @log_path,
        finished_at = @finished_at
      WHERE id = @id
    `),
    markJobFailed: db.prepare(`
      UPDATE code_jobs
      SET
        status = 'failed',
        error_text = @error_text,
        git_status_text = @git_status_text,
        changed_files_json = @changed_files_json,
        output_attachments_json = @output_attachments_json,
        command_preview = @command_preview,
        log_path = @log_path,
        finished_at = @finished_at
      WHERE id = @id
    `),
    failRunningJobs: db.prepare(`
      UPDATE code_jobs
      SET
        status = 'failed',
        error_text = @error_text,
        finished_at = @finished_at
      WHERE status = 'running'
    `),
    getSetting: db.prepare(`SELECT value_json FROM app_settings WHERE key = ?`),
    upsertSetting: db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (@key, @value_json, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `),
    deleteSetting: db.prepare(`DELETE FROM app_settings WHERE key = ?`),
  };

  return {
    createUser(input) {
      const timestamp = nowIso();
      const row = {
        id: input.id || randomId("usr_"),
        username: input.username,
        password_hash: input.passwordHash,
        display_name: input.displayName,
        repo_url: input.repoUrl,
        repo_local_path: input.repoLocalPath || "",
        repo_default_branch: input.repoDefaultBranch || "main",
        chat_model: input.chatModel,
        allowed_models_json: JSON.stringify(input.allowedModels || []),
        can_use_code: input.canUseCode ? 1 : 0,
        is_admin: input.isAdmin ? 1 : 0,
        created_at: timestamp,
        updated_at: timestamp,
      };
      statements.insertUser.run(row);
      return this.getUserById(row.id);
    },

    updateUser(input) {
      statements.updateUser.run({
        id: input.id,
        password_hash: input.passwordHash || null,
        display_name: input.displayName,
        repo_url: input.repoUrl,
        repo_local_path: input.repoLocalPath || "",
        repo_default_branch: input.repoDefaultBranch || "main",
        chat_model: input.chatModel,
        allowed_models_json: JSON.stringify(input.allowedModels || []),
        can_use_code: input.canUseCode ? 1 : 0,
        is_admin: input.isAdmin ? 1 : 0,
        updated_at: nowIso(),
      });
      return this.getUserById(input.id);
    },

    markLoginFailure(userId, { failedLoginAttempts, lockedUntil = null }) {
      statements.updateUserLoginFailure.run({
        id: userId,
        failed_login_attempts: failedLoginAttempts,
        locked_until: lockedUntil,
        updated_at: nowIso(),
      });
      return this.getUserById(userId);
    },

    markLoginSuccess(userId, { ipAddress = "" } = {}) {
      const timestamp = nowIso();
      statements.updateUserLoginSuccess.run({
        id: userId,
        last_login_at: timestamp,
        last_login_ip: ipAddress,
        updated_at: timestamp,
      });
      return this.getUserById(userId);
    },

    listUsers() {
      return parseRows(statements.listUsers.all());
    },

    getUserByUsername(username) {
      return parseRow(statements.getUserByUsername.get(username));
    },

    getUserById(userId) {
      return parseRow(statements.getUserById.get(userId));
    },

    deleteUser(userId) {
      return statements.deleteUser.run(userId).changes > 0;
    },

    createSession({ userId, expiresAt, userAgent = "", ipAddress = "" }) {
      const createdAt = nowIso();
      const row = {
        id: randomId("ses_"),
        user_id: userId,
        expires_at: expiresAt,
        created_at: createdAt,
        user_agent: userAgent,
        ip_address: ipAddress,
        last_seen_at: createdAt,
      };
      statements.insertSession.run(row);
      return row;
    },

    getSession(sessionId) {
      return statements.getSession.get(sessionId) || null;
    },

    touchSession(sessionId, { userAgent = "", ipAddress = "" } = {}) {
      statements.touchSession.run({
        id: sessionId,
        last_seen_at: nowIso(),
        user_agent: userAgent,
        ip_address: ipAddress,
      });
    },

    deleteSession(sessionId) {
      statements.deleteSession.run(sessionId);
    },

    deleteExpiredSessions() {
      statements.deleteExpiredSessions.run(nowIso());
    },

    recordAuthEvent(input) {
      const row = {
        id: input.id || randomId("aud_"),
        user_id: input.userId || null,
        username: input.username || "",
        event_type: input.eventType,
        reason: input.reason || "",
        ip_address: input.ipAddress || "",
        user_agent: input.userAgent || "",
        created_at: input.createdAt || nowIso(),
      };
      statements.insertAuthAuditEvent.run(row);
      return row;
    },

    listAuthAuditEvents(limit = 100) {
      return parseAuditRows(statements.listAuthAuditEvents.all(Math.max(1, Number(limit || 100))));
    },

    listConversations(userId) {
      return parseRows(statements.listConversations.all(userId));
    },

    createConversation(userId, title = "New chat") {
      const row = {
        id: randomId("con_"),
        user_id: userId,
        title,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      statements.insertConversation.run(row);
      return this.getConversation(userId, row.id);
    },

    getConversation(userId, conversationId) {
      return statements.getConversation.get(conversationId, userId) || null;
    },

    maybeRetitleConversation(conversationId, firstUserMessage) {
      statements.updateConversationTitle.run({
        id: conversationId,
        title: truncate(firstUserMessage, 72) || "New chat",
        updated_at: nowIso(),
      });
    },

    setConversationPinned(userId, conversationId, pinned) {
      const conversation = this.getConversation(userId, conversationId);
      if (!conversation) {
        return null;
      }
      statements.updateConversationPinned.run({
        id: conversationId,
        pinned_at: pinned ? nowIso() : null,
      });
      return this.getConversation(userId, conversationId);
    },

    deleteConversation(userId, conversationId) {
      return statements.deleteConversation.run({
        id: conversationId,
        user_id: userId,
      }).changes > 0;
    },

    touchConversation(conversationId) {
      statements.touchConversation.run({
        id: conversationId,
        updated_at: nowIso(),
      });
    },

    listMessages(conversationId) {
      return parseRows(statements.listMessages.all(conversationId));
    },

    getMessage(conversationId, messageId) {
      return parseRow(statements.getMessage.get(messageId, conversationId));
    },

    addMessage({ id, conversationId, role, content, model = null, attachments = [] }) {
      const row = {
        id: id || randomId("msg_"),
        conversation_id: conversationId,
        role,
        content,
        model,
        attachments_json: JSON.stringify(attachments),
        created_at: nowIso(),
      };
      statements.insertMessage.run(row);
      statements.touchConversation.run({
        id: conversationId,
        updated_at: row.created_at,
      });
      return this.getMessage(conversationId, row.id);
    },

    listJobs(userId) {
      return parseRows(statements.listJobs.all(userId));
    },

    getJob(userId, jobId) {
      return parseRow(statements.getJob.get(jobId, userId));
    },

    getJobForWorker(jobId) {
      return parseRow(statements.getJobForWorker.get(jobId));
    },

    createJob(userId, prompt, attachments = [], id = null) {
      const row = {
        id: id || randomId("job_"),
        user_id: userId,
        prompt,
        status: "pending",
        branch_name: "",
        created_at: nowIso(),
        attachments_json: JSON.stringify(attachments),
      };
      statements.insertJob.run(row);
      return this.getJob(userId, row.id);
    },

    setJobPinned(userId, jobId, pinned) {
      const job = this.getJob(userId, jobId);
      if (!job) {
        return null;
      }
      statements.updateJobPinned.run({
        id: jobId,
        pinned_at: pinned ? nowIso() : null,
      });
      return this.getJob(userId, jobId);
    },

    deleteJob(userId, jobId) {
      return statements.deleteJob.run({
        id: jobId,
        user_id: userId,
      }).changes > 0;
    },

    getNextPendingJob() {
      return parseRow(statements.getNextPendingJob.get());
    },

    markJobRunning(jobId, workspacePath, logPath = "", commandPreview = "") {
      statements.markJobRunning.run({
        id: jobId,
        started_at: nowIso(),
        workspace_path: workspacePath,
        log_path: logPath,
        command_preview: commandPreview,
      });
    },

    markJobCompleted(jobId, result) {
      statements.markJobCompleted.run({
        id: jobId,
        final_message: result.finalMessage,
        diff_text: result.diffText,
        diff_stat: result.diffStat,
        git_status_text: result.gitStatusText,
        changed_files_json: JSON.stringify(result.changedFiles || []),
        output_attachments_json: JSON.stringify(result.outputAttachments || []),
        command_preview: result.commandPreview,
        log_path: result.logPath,
        finished_at: nowIso(),
      });
    },

    markJobFailed(jobId, result) {
      statements.markJobFailed.run({
        id: jobId,
        error_text: result.errorText,
        git_status_text: result.gitStatusText || "",
        changed_files_json: JSON.stringify(result.changedFiles || []),
        output_attachments_json: JSON.stringify(result.outputAttachments || []),
        command_preview: result.commandPreview || "",
        log_path: result.logPath || "",
        finished_at: nowIso(),
      });
    },

    failRunningJobs(errorText) {
      statements.failRunningJobs.run({
        error_text: errorText,
        finished_at: nowIso(),
      });
    },

    getSetting(key, fallback = null) {
      const row = statements.getSetting.get(String(key || ""));
      if (!row) {
        return fallback;
      }
      return safeJsonParse(row.value_json, fallback);
    },

    setSetting(key, value) {
      statements.upsertSetting.run({
        key: String(key || ""),
        value_json: JSON.stringify(value),
        updated_at: nowIso(),
      });
      return this.getSetting(key, null);
    },

    deleteSetting(key) {
      return statements.deleteSetting.run(String(key || "")).changes > 0;
    },
  };
}
