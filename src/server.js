import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  storeTextAttachments,
  serializeAttachmentForClient,
  storeUploadedAttachments,
} from "./attachments.js";
import { loadConfig } from "./config.js";
import { ensureDir, joinPath, nowIso, randomId } from "./utils.js";
import { createDatabase } from "./db.js";
import {
  createSessionCookie,
  generateStrongPassword,
  hashPassword,
  parseCookies,
  validatePasswordStrength,
  verifyPassword,
  verifySessionCookie,
} from "./security.js";
import { createChatService } from "./chat-service.js";
import { createJobQueue } from "./job-queue.js";
import { buildChatGeneratedFiles } from "./generated-files.js";

const config = loadConfig();
await ensureDir(config.dataDir);
await ensureDir(config.workspaceRoot);
await ensureDir(config.runsRoot);
await ensureDir(config.uploadsRoot);

const db = createDatabase(config.databasePath);
const chatService = createChatService(config);
const jobQueue = createJobQueue({ config, db });
db.failRunningJobs("Relay Station restarted before the job finished.");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(config.publicDir));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: config.maxUploadFiles,
    fileSize: config.maxUploadBytes,
  },
});

function jsonError(res, status, message) {
  res.status(status).json({ error: message });
}

function attachmentUploadMiddleware(req, res, next) {
  upload.array("attachments", config.maxUploadFiles)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        jsonError(res, 400, `Each attachment must be ${Math.floor(config.maxUploadBytes / (1024 * 1024))} MB or smaller.`);
        return;
      }
      if (error.code === "LIMIT_FILE_COUNT") {
        jsonError(res, 400, `You can upload up to ${config.maxUploadFiles} attachments per request.`);
        return;
      }
      jsonError(res, 400, error.message);
      return;
    }

    next(error);
  });
}

function sessionCookieOptions(ttlHours) {
  const parts = [
    "Path=/",
    "HttpOnly",
    `SameSite=${config.sessionCookieSameSite}`,
    "Priority=High",
    `Max-Age=${ttlHours * 60 * 60}`,
  ];
  if (config.sessionCookieSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function expiredSessionCookie() {
  const parts = [
    `${config.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.sessionCookieSameSite}`,
    "Priority=High",
    "Max-Age=0",
  ];
  if (config.sessionCookieSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function buildConversationMessageAttachmentUrl(conversationId, messageId, attachmentId) {
  return `/api/chat/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}`;
}

function buildCodeJobAttachmentUrl(jobId, attachmentId) {
  return `/api/code/jobs/${jobId}/attachments/${attachmentId}`;
}

function buildCodeJobOutputUrl(jobId, attachmentId) {
  return `/api/code/jobs/${jobId}/outputs/${attachmentId}`;
}

function attachmentPayload(attachment, url) {
  return serializeAttachmentForClient(attachment, url);
}

function writeJsonLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function messageTitleSeed(content, attachments) {
  const text = String(content || "").trim();
  if (text) {
    return text;
  }
  if (attachments.length > 0) {
    return `Attachments: ${attachments.map((attachment) => attachment.name).join(", ")}`;
  }
  return "New chat";
}

function normalizeRequestText(value) {
  return String(value || "").trim().slice(0, 20_000);
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase().slice(0, 64);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "";
}

function passwordPolicyError(password) {
  return validatePasswordStrength(password, {
    minLength: config.authMinPasswordLength,
  });
}

async function saveAttachmentsForMessage({ user, conversationId, messageId, files }) {
  if (!files.length) {
    return [];
  }
  return storeUploadedAttachments({
    files,
    rootDir: joinPath(config.uploadsRoot, "chat", user.id, conversationId, messageId),
  });
}

async function saveAttachmentsForJob({ user, jobId, files }) {
  if (!files.length) {
    return [];
  }
  return storeUploadedAttachments({
    files,
    rootDir: joinPath(config.uploadsRoot, "code", user.id, jobId),
  });
}

async function saveGeneratedChatAttachments({ user, conversationId, messageId, content }) {
  const files = buildChatGeneratedFiles(content);
  if (!files.length) {
    return [];
  }

  return storeTextAttachments({
    files,
    rootDir: joinPath(config.uploadsRoot, "chat-generated", user.id, conversationId, messageId),
  });
}

function findAttachment(attachments, attachmentId) {
  return attachments.find((attachment) => attachment.id === attachmentId) || null;
}

async function sendAttachmentFile(res, attachment) {
  const body = await fs.readFile(attachment.diskPath);
  res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", body.length);
  res.setHeader("Content-Disposition", `inline; filename="${attachment.name.replaceAll('"', "")}"`);
  res.send(body);
}

async function getAuthContext(req) {
  db.deleteExpiredSessions();
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[config.sessionCookieName];
  if (!raw) {
    return null;
  }

  const decoded = verifySessionCookie(raw, config.sessionSecret);
  if (!decoded?.sid) {
    return null;
  }

  const session = db.getSession(decoded.sid);
  if (!session) {
    return null;
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.deleteSession(session.id);
    return null;
  }

  const user = db.getUserById(session.user_id);
  if (!user) {
    db.deleteSession(session.id);
    return null;
  }

  db.touchSession(session.id, {
    ipAddress: clientIp(req),
    userAgent: String(req.headers["user-agent"] || ""),
  });

  return { user, session };
}

async function getAuthUser(req) {
  const context = await getAuthContext(req);
  return context?.user || null;
}

async function requireAuth(req, res, next) {
  const context = await getAuthContext(req);
  if (!context?.user) {
    return jsonError(res, 401, "Authentication required.");
  }
  req.user = context.user;
  req.authSession = context.session;
  return next();
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    canUseCode: Boolean(user.canUseCode),
    isAdmin: Boolean(user.isAdmin),
    failedLoginAttempts: Number(user.failedLoginAttempts || 0),
    lockedUntil: user.locked_until || "",
    lastLoginAt: user.last_login_at || "",
    lastLoginIp: user.last_login_ip || "",
  };
}

async function requireCodeAccess(req, res, next) {
  const context = await getAuthContext(req);
  if (!context?.user) {
    return jsonError(res, 401, "Authentication required.");
  }
  if (!context.user.canUseCode) {
    return jsonError(res, 403, "This account cannot use Code mode.");
  }
  req.user = context.user;
  req.authSession = context.session;
  return next();
}

async function requireAdmin(req, res, next) {
  const context = await getAuthContext(req);
  if (!context?.user) {
    return jsonError(res, 401, "Authentication required.");
  }
  if (!context.user.isAdmin) {
    return jsonError(res, 403, "Administrator access required.");
  }
  req.user = context.user;
  req.authSession = context.session;
  return next();
}

function serializeAdminUser(user) {
  return {
    ...serializeUser(user),
    repoUrl: user.repo_url,
    repoLocalPath: user.repo_local_path,
  };
}

function conversationPayload(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    pinnedAt: conversation.pinned_at,
    isPinned: Boolean(conversation.isPinned),
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  };
}

function messagePayload(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model,
    attachments: (message.attachments || []).map((attachment) =>
      attachmentPayload(
        attachment,
        buildConversationMessageAttachmentUrl(message.conversation_id, message.id, attachment.id),
      ),
    ),
    createdAt: message.created_at,
  };
}

function jobPayload(job) {
  if (!job) {
    return null;
  }
  return {
    id: job.id,
    status: job.status,
    pinnedAt: job.pinned_at,
    isPinned: Boolean(job.isPinned),
    prompt: job.prompt,
    branchName: job.branch_name,
    workspacePath: job.workspace_path,
    finalMessage: job.final_message,
    errorText: job.error_text,
    diffText: job.diff_text,
    diffStat: job.diff_stat,
    gitStatusText: job.git_status_text,
    changedFiles: job.changedFiles || [],
    attachments: (job.attachments || []).map((attachment) =>
      attachmentPayload(attachment, buildCodeJobAttachmentUrl(job.id, attachment.id)),
    ),
    outputFiles: (job.outputAttachments || []).map((attachment) =>
      attachmentPayload(attachment, buildCodeJobOutputUrl(job.id, attachment.id)),
    ),
    commandPreview: job.command_preview,
    logPath: job.log_path,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: nowIso(),
    queue: jobQueue.stats(),
    chatConfigured: chatService.isConfigured(),
  });
});

app.post("/api/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const ipAddress = clientIp(req);
  const userAgent = String(req.headers["user-agent"] || "");
  const user = db.getUserByUsername(username);

  if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    db.recordAuthEvent({
      userId: user.id,
      username,
      eventType: "login_blocked",
      reason: `locked_until:${user.locked_until}`,
      ipAddress,
      userAgent,
    });
    return jsonError(res, 423, `Account temporarily locked until ${new Date(user.locked_until).toLocaleString()}.`);
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    if (user) {
      const nextAttempts = Number(user.failedLoginAttempts || 0) + 1;
      const lockedUntil =
        nextAttempts >= config.authMaxFailedAttempts
          ? new Date(Date.now() + config.authLockoutMinutes * 60 * 1000).toISOString()
          : null;
      db.markLoginFailure(user.id, {
        failedLoginAttempts: lockedUntil ? 0 : nextAttempts,
        lockedUntil,
      });
      db.recordAuthEvent({
        userId: user.id,
        username,
        eventType: lockedUntil ? "login_locked" : "login_failed",
        reason: lockedUntil ? `failed_attempt_limit:${config.authMaxFailedAttempts}` : "invalid_password",
        ipAddress,
        userAgent,
      });
      if (lockedUntil) {
        return jsonError(res, 423, `Account temporarily locked until ${new Date(lockedUntil).toLocaleString()}.`);
      }
    } else {
      db.recordAuthEvent({
        userId: "",
        username,
        eventType: "login_failed",
        reason: "unknown_user",
        ipAddress,
        userAgent,
      });
    }
    return jsonError(res, 401, "Invalid username or password.");
  }

  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[config.sessionCookieName];
  const decoded = verifySessionCookie(raw, config.sessionSecret);
  if (decoded?.sid) {
    db.deleteSession(decoded.sid);
  }

  const authenticatedUser = db.markLoginSuccess(user.id, { ipAddress });
  db.recordAuthEvent({
    userId: user.id,
    username,
    eventType: "login_success",
    reason: "password",
    ipAddress,
    userAgent,
  });

  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000).toISOString();
  const session = db.createSession({
    userId: user.id,
    expiresAt,
    ipAddress,
    userAgent,
  });

  res.setHeader(
    "Set-Cookie",
    `${config.sessionCookieName}=${createSessionCookie(session, config.sessionSecret)}; ${sessionCookieOptions(config.sessionTtlHours)}`,
  );
  res.json({
    user: serializeUser(authenticatedUser),
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const authUser = await getAuthUser(req);
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[config.sessionCookieName];
  const decoded = verifySessionCookie(raw, config.sessionSecret);
  if (decoded?.sid) {
    db.deleteSession(decoded.sid);
  }
  db.recordAuthEvent({
    userId: authUser?.id || "",
    username: authUser?.username || "",
    eventType: "logout",
    reason: "user_request",
    ipAddress: clientIp(req),
    userAgent: String(req.headers["user-agent"] || ""),
  });
  res.setHeader("Set-Cookie", expiredSessionCookie());
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, async (req, res) => {
  res.json({
    user: serializeUser(req.user),
    chat: {
      configured: chatService.isConfigured(),
      providers: chatService.listProviders(),
      defaultProviderId: chatService.defaultProviderId(),
    },
    capabilities: {
      code: Boolean(req.user.canUseCode),
      admin: Boolean(req.user.isAdmin),
    },
    queue: jobQueue.stats(),
  });
});

app.get("/api/admin/overview", requireAdmin, async (req, res) => {
  res.json({
    summary: {
      users: db.listUsers().length,
      queue: jobQueue.stats(),
      configuredProviders: chatService.listProviders().length,
      configuredApiKeys: chatService.listApiKeys().length,
    },
    users: db.listUsers().map(serializeAdminUser),
    authEvents: db.listAuthAuditEvents(100),
    apiKeys: chatService.listApiKeys(),
    dispatchEvents: chatService.listDispatchEvents(150),
    autoRouting: chatService.describeAutoRouting(),
  });
});

app.get("/api/chat/conversations", requireAuth, async (req, res) => {
  const conversations = db.listConversations(req.user.id).map(conversationPayload);
  res.json({ conversations });
});

app.post("/api/chat/conversations", requireAuth, async (req, res) => {
  const conversation = db.createConversation(req.user.id, String(req.body?.title || "New chat"));
  res.status(201).json({ conversation: conversationPayload(conversation) });
});

app.patch("/api/chat/conversations/:conversationId", requireAuth, async (req, res) => {
  const conversation = db.getConversation(req.user.id, req.params.conversationId);
  if (!conversation) {
    return jsonError(res, 404, "Conversation not found.");
  }

  if (typeof req.body?.pinned !== "boolean") {
    return jsonError(res, 400, "Pinned flag is required.");
  }

  const updated = db.setConversationPinned(req.user.id, conversation.id, req.body.pinned);
  return res.json({ conversation: conversationPayload(updated) });
});

app.delete("/api/chat/conversations/:conversationId", requireAuth, async (req, res) => {
  const conversation = db.getConversation(req.user.id, req.params.conversationId);
  if (!conversation) {
    return jsonError(res, 404, "Conversation not found.");
  }

  db.deleteConversation(req.user.id, conversation.id);
  return res.json({ ok: true });
});

app.get("/api/chat/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  const conversation = db.getConversation(req.user.id, req.params.conversationId);
  if (!conversation) {
    return jsonError(res, 404, "Conversation not found.");
  }

  const messages = db.listMessages(conversation.id).map(messagePayload);
  res.json({
    conversation: conversationPayload(conversation),
    messages,
  });
});

app.post("/api/chat/conversations/:conversationId/messages", requireAuth, attachmentUploadMiddleware, async (req, res) => {
  const conversation = db.getConversation(req.user.id, req.params.conversationId);
  if (!conversation) {
    return jsonError(res, 404, "Conversation not found.");
  }

  const files = Array.isArray(req.files) ? req.files : [];
  const content = normalizeRequestText(req.body?.content);
  const requestedProviderId = String(req.body?.providerId || "").trim();
  const requestedModel = String(req.body?.model || "").trim();
  if (!content && files.length === 0) {
    return jsonError(res, 400, "Add a message or at least one attachment.");
  }

  const messageId = randomId("msg_");
  const attachments = await saveAttachmentsForMessage({
    user: req.user,
    conversationId: conversation.id,
    messageId,
    files,
  });

  db.addMessage({
    id: messageId,
    conversationId: conversation.id,
    role: "user",
    content,
    model: requestedModel,
    attachments,
  });

  const history = db.listMessages(conversation.id);
  if (history.filter((entry) => entry.role === "user").length === 1) {
    db.maybeRetitleConversation(conversation.id, messageTitleSeed(content, attachments));
  }

  try {
    const reply = await chatService.respond({
      user: req.user,
      history,
      providerId: requestedProviderId,
      model: requestedModel,
      conversationId: conversation.id,
    });

    const assistantMessageId = randomId("msg_");
    const assistantAttachments = await saveGeneratedChatAttachments({
      user: req.user,
      conversationId: conversation.id,
      messageId: assistantMessageId,
      content: reply.text,
    });

    const assistantMessage = db.addMessage({
      id: assistantMessageId,
      conversationId: conversation.id,
      role: "assistant",
      content: reply.text,
      model: reply.model,
      attachments: assistantAttachments,
    });

    return res.status(201).json({
      message: {
        ...messagePayload(assistantMessage),
        providerId: reply.providerId,
        providerLabel: reply.providerLabel,
      },
      conversation: conversationPayload(db.getConversation(req.user.id, conversation.id)),
    });
  } catch (error) {
    return jsonError(res, 500, error instanceof Error ? error.message : "Chat request failed.");
  }
});

app.post("/api/chat/conversations/:conversationId/messages/stream", requireAuth, attachmentUploadMiddleware, async (req, res) => {
  const conversation = db.getConversation(req.user.id, req.params.conversationId);
  if (!conversation) {
    return jsonError(res, 404, "Conversation not found.");
  }

  const files = Array.isArray(req.files) ? req.files : [];
  const content = normalizeRequestText(req.body?.content);
  const requestedProviderId = String(req.body?.providerId || "").trim();
  const requestedModel = String(req.body?.model || "").trim();
  if (!content && files.length === 0) {
    return jsonError(res, 400, "Add a message or at least one attachment.");
  }

  const userMessageId = randomId("msg_");
  const userAttachments = await saveAttachmentsForMessage({
    user: req.user,
    conversationId: conversation.id,
    messageId: userMessageId,
    files,
  });

  db.addMessage({
    id: userMessageId,
    conversationId: conversation.id,
    role: "user",
    content,
    model: requestedModel,
    attachments: userAttachments,
  });

  const history = db.listMessages(conversation.id);
  if (history.filter((entry) => entry.role === "user").length === 1) {
    db.maybeRetitleConversation(conversation.id, messageTitleSeed(content, userAttachments));
  }

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  try {
    const reply = await chatService.streamRespond({
      user: req.user,
      history,
      providerId: requestedProviderId,
      model: requestedModel,
      conversationId: conversation.id,
      onStart(meta) {
        writeJsonLine(res, {
          type: "meta",
          ...meta,
        });
      },
      onDelta(delta, text) {
        writeJsonLine(res, {
          type: "delta",
          delta,
          text,
        });
      },
    });

    const assistantMessageId = randomId("msg_");
    const assistantAttachments = await saveGeneratedChatAttachments({
      user: req.user,
      conversationId: conversation.id,
      messageId: assistantMessageId,
      content: reply.text,
    });

    const assistantMessage = db.addMessage({
      id: assistantMessageId,
      conversationId: conversation.id,
      role: "assistant",
      content: reply.text,
      model: reply.model,
      attachments: assistantAttachments,
    });

    writeJsonLine(res, {
      type: "done",
      message: {
        ...messagePayload(assistantMessage),
        providerId: reply.providerId,
        providerLabel: reply.providerLabel,
      },
      conversation: conversationPayload(db.getConversation(req.user.id, conversation.id)),
    });
  } catch (error) {
    writeJsonLine(res, {
      type: "error",
      error: error instanceof Error ? error.message : "Chat request failed.",
    });
  }

  return res.end();
});

app.get(
  "/api/chat/conversations/:conversationId/messages/:messageId/attachments/:attachmentId",
  requireAuth,
  async (req, res) => {
    const conversation = db.getConversation(req.user.id, req.params.conversationId);
    if (!conversation) {
      return jsonError(res, 404, "Conversation not found.");
    }

    const message = db.getMessage(conversation.id, req.params.messageId);
    if (!message) {
      return jsonError(res, 404, "Message not found.");
    }

    const attachment = findAttachment(message.attachments || [], req.params.attachmentId);
    if (!attachment) {
      return jsonError(res, 404, "Attachment not found.");
    }

    return sendAttachmentFile(res, attachment);
  },
);

app.get("/api/code/jobs", requireCodeAccess, async (req, res) => {
  const jobs = db.listJobs(req.user.id).map(jobPayload);
  res.json({
    jobs,
    queue: jobQueue.stats(),
  });
});

app.post("/api/code/jobs", requireCodeAccess, attachmentUploadMiddleware, async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const rawPrompt = normalizeRequestText(req.body?.prompt);
  if (!rawPrompt && files.length === 0) {
    return jsonError(res, 400, "Add a task description or at least one attachment.");
  }

  const prompt =
    rawPrompt ||
    `Use the uploaded attachments as the primary task input.\nAttachments: ${files.map((file) => file.originalname || "file").join(", ")}`;
  const jobId = randomId("job_");
  const attachments = await saveAttachmentsForJob({
    user: req.user,
    jobId,
    files,
  });
  const job = db.createJob(req.user.id, prompt, attachments, jobId);
  jobQueue.schedule();
  res.status(201).json({
    job: jobPayload(job),
  });
});

app.get("/api/code/jobs/:jobId", requireCodeAccess, async (req, res) => {
  const job = db.getJob(req.user.id, req.params.jobId);
  if (!job) {
    return jsonError(res, 404, "Job not found.");
  }

  res.json({ job: jobPayload(job) });
});

app.patch("/api/code/jobs/:jobId", requireCodeAccess, async (req, res) => {
  const job = db.getJob(req.user.id, req.params.jobId);
  if (!job) {
    return jsonError(res, 404, "Job not found.");
  }

  if (typeof req.body?.pinned !== "boolean") {
    return jsonError(res, 400, "Pinned flag is required.");
  }

  const updated = db.setJobPinned(req.user.id, job.id, req.body.pinned);
  return res.json({ job: jobPayload(updated) });
});

app.delete("/api/code/jobs/:jobId", requireCodeAccess, async (req, res) => {
  const job = db.getJob(req.user.id, req.params.jobId);
  if (!job) {
    return jsonError(res, 404, "Job not found.");
  }
  if (job.status === "running") {
    return jsonError(res, 400, "Running jobs cannot be deleted.");
  }

  db.deleteJob(req.user.id, job.id);

  await Promise.all([
    fs.rm(joinPath(config.uploadsRoot, "code", req.user.id, job.id), { recursive: true, force: true }),
    fs.rm(joinPath(config.uploadsRoot, "code-generated", req.user.id, job.id), { recursive: true, force: true }),
    fs.rm(joinPath(config.workspaceRoot, req.user.id, job.id), { recursive: true, force: true }),
    fs.rm(joinPath(config.runsRoot, req.user.id, job.id), { recursive: true, force: true }),
  ]);

  return res.json({ ok: true });
});

app.get("/api/code/jobs/:jobId/attachments/:attachmentId", requireCodeAccess, async (req, res) => {
  const job = db.getJob(req.user.id, req.params.jobId);
  if (!job) {
    return jsonError(res, 404, "Job not found.");
  }

  const attachment = findAttachment(job.attachments || [], req.params.attachmentId);
  if (!attachment) {
    return jsonError(res, 404, "Attachment not found.");
  }

  return sendAttachmentFile(res, attachment);
});

app.get("/api/code/jobs/:jobId/outputs/:attachmentId", requireCodeAccess, async (req, res) => {
  const job = db.getJob(req.user.id, req.params.jobId);
  if (!job) {
    return jsonError(res, 404, "Job not found.");
  }

  const attachment = findAttachment(job.outputAttachments || [], req.params.attachmentId);
  if (!attachment) {
    return jsonError(res, 404, "Output file not found.");
  }

  return sendAttachmentFile(res, attachment);
});

app.get("/api/code/jobs/:jobId/log", requireCodeAccess, async (req, res) => {
  const job = db.getJob(req.user.id, req.params.jobId);
  if (!job) {
    return jsonError(res, 404, "Job not found.");
  }

  if (!job.log_path) {
    return res.json({ log: "" });
  }

  const log = await fs.readFile(job.log_path, "utf8").catch(() => "");
  res.json({ log });
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }
  return res.sendFile(path.join(config.publicDir, "index.html"));
});

function defaultChatSelection() {
  const provider = config.chatProviders[0];
  return {
    chatModel: provider?.defaultModel || "chat-disabled",
    allowedModels: provider?.models || [],
  };
}

function assertStrongPassword(password, label) {
  const message = passwordPolicyError(password);
  if (message) {
    throw new Error(`${label} ${message}`);
  }
}

async function ensureRootAdminUser() {
  const existing = db.getUserByUsername(config.rootAdminUsername);
  const defaults = defaultChatSelection();

  if (existing) {
    if (!existing.isAdmin) {
      db.updateUser({
        id: existing.id,
        displayName: existing.display_name,
        repoUrl: existing.repo_url,
        repoLocalPath: existing.repo_local_path,
        repoDefaultBranch: existing.repo_default_branch,
        chatModel: existing.chat_model,
        allowedModels: existing.allowedModels,
        canUseCode: Boolean(existing.canUseCode),
        isAdmin: true,
      });
      console.log(`Promoted ${config.rootAdminUsername} to administrator.`);
    }
    return;
  }

  let rootPassword = String(config.rootAdminPassword || "").trim();
  let wroteCredentialFile = false;
  if (!rootPassword) {
    rootPassword = generateStrongPassword(20);
    await fs.writeFile(
      config.rootAdminPasswordFile,
      `username=${config.rootAdminUsername}\npassword=${rootPassword}\n`,
      { mode: 0o600 },
    );
    wroteCredentialFile = true;
  }

  assertStrongPassword(rootPassword, "Root admin password:");

  db.createUser({
    username: config.rootAdminUsername,
    passwordHash: hashPassword(rootPassword),
    displayName: config.rootAdminDisplayName,
    repoUrl: config.rootAdminRepoUrl,
    repoLocalPath: config.rootAdminRepoPath,
    repoDefaultBranch: config.rootAdminRepoBranch,
    chatModel: defaults.chatModel,
    allowedModels: defaults.allowedModels,
    canUseCode: false,
    isAdmin: true,
  });

  if (wroteCredentialFile) {
    console.log(`Bootstrapped root admin user. Credentials saved to ${config.rootAdminPasswordFile}.`);
  } else {
    console.log(`Bootstrapped root admin user ${config.rootAdminUsername}.`);
  }
}

async function maybeBootstrapDefaultUser() {
  const bootstrapUsername = process.env.BOOTSTRAP_USERNAME || "owner";
  const bootstrapPassword = process.env.BOOTSTRAP_PASSWORD;
  if (!bootstrapPassword) {
    return;
  }
  if (db.getUserByUsername(bootstrapUsername)) {
    return;
  }

  assertStrongPassword(bootstrapPassword, "Bootstrap password:");
  const bootstrapProvider = defaultChatSelection();
  db.createUser({
    username: bootstrapUsername,
    passwordHash: hashPassword(bootstrapPassword),
    displayName: process.env.BOOTSTRAP_DISPLAY_NAME || "Owner",
    repoUrl: process.env.BOOTSTRAP_REPO_URL || config.initialRepoUrl,
    repoLocalPath: process.env.BOOTSTRAP_REPO_PATH || config.initialRepoPath,
    repoDefaultBranch: process.env.BOOTSTRAP_REPO_BRANCH || "main",
    chatModel: bootstrapProvider.chatModel,
    allowedModels: bootstrapProvider.allowedModels,
    canUseCode: process.env.BOOTSTRAP_CODE_ENABLED === "1",
    isAdmin: false,
  });
  console.log("Bootstrapped default user.");
}

await ensureRootAdminUser();
await maybeBootstrapDefaultUser();
jobQueue.schedule();

app.listen(config.port, () => {
  console.log(`${config.appName} listening on http://127.0.0.1:${config.port}`);
});
