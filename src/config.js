import os from "node:os";
import path from "node:path";
import { buildChatProviders } from "./chat-providers.js";

export function loadConfig() {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
  const publicDir = path.join(rootDir, "public");
  const workspaceRoot =
    process.env.WORKSPACE_ROOT ||
    path.join(dataDir, "workspaces");
  const runsRoot =
    process.env.RUNS_ROOT ||
    path.join(dataDir, "runs");
  const uploadsRoot =
    process.env.UPLOADS_ROOT ||
    path.join(dataDir, "uploads");
  const uploadsTempRoot =
    process.env.UPLOADS_TEMP_ROOT ||
    path.join(dataDir, "incoming-uploads");
  const chat = buildChatProviders(process.env);

  return {
    appName: process.env.APP_NAME || "Relay Station",
    rootDir,
    dataDir,
    publicDir,
    databasePath: process.env.DATABASE_PATH || path.join(dataDir, "app.db"),
    workspaceRoot,
    runsRoot,
    uploadsRoot,
    uploadsTempRoot,
    port: Number(process.env.PORT || 3210),
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "relay_station_session",
    sessionSecret: process.env.APP_SESSION_SECRET || "",
    sessionCookieSameSite: process.env.SESSION_COOKIE_SAME_SITE || "Strict",
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === "1",
    chatProviders: chat.providers,
    defaultChatProviderId: chat.defaultProviderId,
    codexBin: process.env.CODEX_BIN || "codex",
    codexTimeoutMs: Number(process.env.CODEX_TIMEOUT_MS || 30 * 60 * 1000),
    codeQueueConcurrency: Number(process.env.CODE_QUEUE_CONCURRENCY || 1),
    codeAutoPush: process.env.CODE_AUTO_PUSH !== "0",
    gitPushTimeoutMs: Number(process.env.GIT_PUSH_TIMEOUT_MS || 5 * 60 * 1000),
    gitAuthorName: process.env.GIT_AUTHOR_NAME || "Relay Station Bot",
    gitAuthorEmail: process.env.GIT_AUTHOR_EMAIL || "relay-station@local",
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 24 * 7),
    maxUploadFiles: Number(process.env.MAX_UPLOAD_FILES || 5),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
    chatAttachmentTextBytes: Number(process.env.CHAT_ATTACHMENT_TEXT_BYTES || 64 * 1024),
    chatInlineImageBytes: Number(process.env.CHAT_INLINE_IMAGE_BYTES || 5 * 1024 * 1024),
    autoChatRetryCooldownMs: Number(process.env.AUTO_CHAT_RETRY_COOLDOWN_MS || 2 * 60 * 1000),
    autoChatQuotaCooldownMs: Number(process.env.AUTO_CHAT_QUOTA_COOLDOWN_MS || 15 * 60 * 1000),
    autoChatCircuitBreakerThreshold: Number(process.env.AUTO_CHAT_CIRCUIT_BREAKER_THRESHOLD || 3),
    autoChatCircuitBreakerMs: Number(process.env.AUTO_CHAT_CIRCUIT_BREAKER_MS || 10 * 60 * 1000),
    adminDispatchHistoryLimit: Number(process.env.ADMIN_DISPATCH_HISTORY_LIMIT || 200),
    attachmentDownloadDebounceMs: Number(process.env.ATTACHMENT_DOWNLOAD_DEBOUNCE_MS || 1500),
    attachmentDownloadMaxInFlightPerFile: Number(process.env.ATTACHMENT_DOWNLOAD_MAX_IN_FLIGHT_PER_FILE || 1),
    authMinPasswordLength: Number(process.env.AUTH_MIN_PASSWORD_LENGTH || 6),
    authMaxFailedAttempts: Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5),
    authLockoutMinutes: Number(process.env.AUTH_LOCKOUT_MINUTES || 15),
    authLoginRateLimitWindowMs: Number(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
    authLoginRateLimitMaxAttempts: Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 20),
    authRegisterRateLimitWindowMs: Number(process.env.AUTH_REGISTER_RATE_LIMIT_WINDOW_MS || 30 * 60 * 1000),
    authRegisterRateLimitMaxAttempts: Number(process.env.AUTH_REGISTER_RATE_LIMIT_MAX_ATTEMPTS || 6),
    rootAdminUsername: process.env.ROOT_ADMIN_USERNAME || "root",
    rootAdminDisplayName: process.env.ROOT_ADMIN_DISPLAY_NAME || "Root Admin",
    rootAdminPassword: process.env.ROOT_ADMIN_PASSWORD || "",
    rootAdminAllowWeakPassword: process.env.ROOT_ADMIN_ALLOW_WEAK_PASSWORD === "1",
    rootAdminRepoUrl: process.env.ROOT_ADMIN_REPO_URL || "",
    rootAdminRepoPath: process.env.ROOT_ADMIN_REPO_PATH || "",
    rootAdminRepoBranch: process.env.ROOT_ADMIN_REPO_BRANCH || "main",
    rootAdminPasswordFile: path.join(dataDir, "root-admin-password.txt"),
    hostUserHome: os.homedir(),
  };
}
